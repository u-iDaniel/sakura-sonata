package main

import (
	"encoding/json"
	"errors"
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

	var title string

	// Get result from DB
	query := `
		SELECT title
		FROM scores
		WHERE id = $1;
	`

	err := app.db.QueryRow(r.Context(), query, id).Scan(&title)
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
