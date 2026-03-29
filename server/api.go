package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/jackc/pgx/v5"
)

type getScoreResponse struct {
	Id    string `json:"id"`
	Title string `json:"title"`
}

type getScoresResponse struct {
	Id        string    `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UserId    string    `json:"user_id"`
}

func (app *App) getScoreHandler(w http.ResponseWriter, r *http.Request) {
	if !checkInternalAPISecret(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	id := r.URL.Query().Get("id")

	if id == "" {
		// Return some 400 error here
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	userId := r.URL.Query().Get("userId")
	if userId == "" {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	var title string

	// Get result from DB
	query := `
		SELECT title
		FROM scores
		WHERE id = $1 AND user_id = $2;
	`

	err := app.db.QueryRow(r.Context(), query, id, userId).Scan(&title)
	if err != nil {
		switch err {
		case pgx.ErrNoRows:
			http.Error(w, "Not found", http.StatusNotFound)
		default:
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
		return
	}

	data := getScoreResponse{
		Id:    id,
		Title: title,
	}

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(data); err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
}

func (app *App) getScoresHandler(w http.ResponseWriter, r *http.Request) {
	if !checkInternalAPISecret(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	userId := r.URL.Query().Get("userId")
	if userId == "" {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	query := `
		SELECT id, title, created_at, user_id
		FROM scores
		WHERE user_id = $1
		ORDER BY created_at DESC;
	`

	rows, err := app.db.Query(r.Context(), query, userId)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	defer rows.Close()

	scores := []getScoresResponse{}

	for rows.Next() {
		var s getScoresResponse
		if err := rows.Scan(&s.Id, &s.Title, &s.CreatedAt, &s.UserId); err != nil {
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}

		scores = append(scores, s)
	}

	rows.Close()

	if err := rows.Err(); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(scores); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
}

func (app *App) getMidiHandler(w http.ResponseWriter, r *http.Request) {
	if !checkInternalAPISecret(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	userId := r.URL.Query().Get("userId")
	if userId == "" {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	// Fetch score record to verify ownership + get the storage bucket path
	var filePath, title string

	query := `
		SELECT title, file_path
		FROM scores
		WHERE id = $1 AND user_id = $2;
	`

	err := app.db.QueryRow(r.Context(), query, id, userId).Scan(&title, &filePath)
	if err != nil {
		switch err {
		case pgx.ErrNoRows:
			http.Error(w, "Resource not found", http.StatusNotFound)
		default:
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
		return
	}

	if filePath == "" {
		http.Error(w, "Score has no associated MIDI file", http.StatusNotFound)
		return
	}

	// Get the MIDI file from s3 now
	params := &s3.GetObjectInput{
		Bucket: &app.midiBucket,
		Key:    &filePath,
	}

	data, err := app.s3.GetObject(r.Context(), params)
	if err != nil {
		if _, ok := errors.AsType[*types.NoSuchKey](err); ok {
			http.Error(w, "MIDI file not found", http.StatusNotFound)
		} else {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
		return
	}
	defer data.Body.Close()

	if data.ContentLength != nil {
		w.Header().Set("Content-Length", strconv.FormatInt(*data.ContentLength, 10))
	}
	w.Header().Set("Content-Type", "audio/midi")

	// Streams the file data into the http response writer
	if _, err := io.Copy(w, data.Body); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
}

func (app *App) uploadMidiHandler(w http.ResponseWriter, r *http.Request) {
	if !checkInternalAPISecret(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	userId := r.URL.Query().Get("userId")
	if userId == "" {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	filePath := r.URL.Query().Get("filePath")
	if filePath == "" {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	// Grab MIDI file from request
	const MAX_FILE_SIZE = 10 << 20                              // 10 MB
	if err := r.ParseMultipartForm(MAX_FILE_SIZE); err != nil { // max file size stored in memory
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Missing file", http.StatusBadRequest)
		return
	}
	if fileHeader.Size > MAX_FILE_SIZE {
		http.Error(w, fmt.Sprintf("File is too large (max size is %v)", uint(MAX_FILE_SIZE)>>20), http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Check if object already exists in s3 bucket (by seeing if the key exists since we hash the contents of the file so the same file will have the same name)
	_, err = app.s3.HeadObject(r.Context(), &s3.HeadObjectInput{
		Bucket: &app.midiBucket,
		Key:    &filePath,
	})
	if err == nil {
		// No error means that the object did exist before
		http.Error(w, "File already exists", http.StatusConflict)
		return
	} else if _, ok := errors.AsType[*types.NotFound](err); !ok {
		// If the error isn't a Not Found error then it's an actual error
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Upload to s3 bucket
	params := &s3.PutObjectInput{
		Bucket: &app.midiBucket,
		Key:    &filePath,
		Body:   file,
		// might have to specify content type?
	}
	_, err = app.s3.PutObject(r.Context(), params)
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Insert a row in the scores table now
	query := `
		INSERT INTO scores (user_id, title, file_path)
		VALUES ($1, $2, $3)
	`
	_, err = app.db.Exec(r.Context(), query, userId, fileHeader.Filename, filePath)
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	w.Write([]byte(`{"success": true}`))
}
