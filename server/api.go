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
	awscfg "github.com/u-iDaniel/sakura-sonata/aws"
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

type uploadMidiResponse struct {
	ScoreId string `json:"score_id"`
}

type musicXMLConversionMessage struct {
	ScoreId string `json:"score_id"`
}

func (app *App) getScoreHandler(w http.ResponseWriter, r *http.Request) {
	if !checkInternalAPISecret(r) {
		app.writeError(w, r, http.StatusForbidden, "Forbidden", "missing or invalid internal API secret", nil)
		return
	}

	id := r.URL.Query().Get("id")

	if id == "" {
		app.writeError(w, r, http.StatusBadRequest, "Bad request", "missing id query parameter", nil)
		return
	}

	userId := r.URL.Query().Get("userId")
	if userId == "" {
		app.writeError(w, r, http.StatusBadRequest, "Bad request", "missing userId query parameter", nil)
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
			app.writeError(w, r, http.StatusNotFound, "Not found", "score not found for id/user", err)
		default:
			app.writeError(w, r, http.StatusInternalServerError, "Internal server error", "database query for score failed", err)
		}
		return
	}

	data := getScoreResponse{
		Id:    id,
		Title: title,
	}

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(data); err != nil {
		app.writeError(w, r, http.StatusInternalServerError, "Internal server error", "failed to encode getScore response", err)
		return
	}
}

func (app *App) deleteScoreHandler(w http.ResponseWriter, r *http.Request) {
	if !checkInternalAPISecret(r) {
		app.writeError(w, r, http.StatusForbidden, "Forbidden", "missing or invalid internal API secret", nil)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		app.writeError(w, r, http.StatusBadRequest, "Bad request", "missing id query parameter", nil)
		return
	}

	userId := r.URL.Query().Get("userId")
	if userId == "" {
		app.writeError(w, r, http.StatusBadRequest, "Bad request", "missing userId query parameter", nil)
		return
	}

	// Delete the associated MIDI file in the s3 first
	var filePath string
	query := `
		SELECT file_path
		FROM scores
		WHERE id = $1 AND user_id = $2;
	`

	err := app.db.QueryRow(r.Context(), query, id, userId).Scan(&filePath)
	if err != nil {
		switch err {
		case pgx.ErrNoRows:
			app.writeError(w, r, http.StatusNotFound, "Not found", "score not found while resolving file path", err)
		default:
			app.writeError(w, r, http.StatusInternalServerError, "Internal server error", "database query for score file path failed", err)
		}
		return
	}

	if filePath != "" {
		// Proceed with deletion of s3 file
		_, err = app.s3.DeleteObject(r.Context(), &s3.DeleteObjectInput{
			Bucket: &app.midiBucket,
			Key:    &filePath,
		})

		if _, ok := errors.AsType[*types.NoSuchKey](err); err != nil && !ok {
			app.writeError(w, r, http.StatusInternalServerError, "Internal server error", "failed deleting MIDI from S3", err)
			return
		}
	}

	deleteQuery := `
		DELETE FROM scores
		WHERE id = $1 AND user_id = $2;
	`

	_, err = app.db.Exec(r.Context(), deleteQuery, id, userId)
	if err != nil {
		app.writeError(w, r, http.StatusInternalServerError, "Internal server error", "failed deleting score row", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (app *App) getScoresHandler(w http.ResponseWriter, r *http.Request) {
	if !checkInternalAPISecret(r) {
		app.writeError(w, r, http.StatusForbidden, "Forbidden", "missing or invalid internal API secret", nil)
		return
	}

	userId := r.URL.Query().Get("userId")
	if userId == "" {
		app.writeError(w, r, http.StatusBadRequest, "Bad request", "missing userId query parameter", nil)
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
		app.writeError(w, r, http.StatusInternalServerError, "Internal Server Error", "database query for scores failed", err)
		return
	}

	defer rows.Close()

	scores := []getScoresResponse{}

	for rows.Next() {
		var s getScoresResponse
		if err := rows.Scan(&s.Id, &s.Title, &s.CreatedAt, &s.UserId); err != nil {
			app.writeError(w, r, http.StatusInternalServerError, "Internal Server Error", "failed to scan score row", err)
			return
		}

		scores = append(scores, s)
	}

	rows.Close()

	if err := rows.Err(); err != nil {
		app.writeError(w, r, http.StatusInternalServerError, "Internal Server Error", "rows iteration failed", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(scores); err != nil {
		app.writeError(w, r, http.StatusInternalServerError, "Internal Server Error", "failed to encode getScores response", err)
		return
	}
}

func (app *App) getMidiHandler(w http.ResponseWriter, r *http.Request) {
	if !checkInternalAPISecret(r) {
		app.writeError(w, r, http.StatusForbidden, "Forbidden", "missing or invalid internal API secret", nil)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		app.writeError(w, r, http.StatusBadRequest, "Bad request", "missing id query parameter", nil)
		return
	}

	userId := r.URL.Query().Get("userId")
	if userId == "" {
		app.writeError(w, r, http.StatusBadRequest, "Bad request", "missing userId query parameter", nil)
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
			app.writeError(w, r, http.StatusNotFound, "Resource not found", "score not found while resolving MIDI path", err)
		default:
			app.writeError(w, r, http.StatusInternalServerError, "Internal server error", "database query for MIDI path failed", err)
		}
		return
	}

	if filePath == "" {
		app.writeError(w, r, http.StatusNotFound, "Score has no associated MIDI file", "score has empty MIDI file path", nil)
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
			app.writeError(w, r, http.StatusNotFound, "MIDI file not found", "MIDI key not found in S3", err)
		} else {
			app.writeError(w, r, http.StatusInternalServerError, "Internal server error", "failed to fetch MIDI from S3", err)
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
		app.writeError(w, r, http.StatusInternalServerError, "Internal Server Error", "failed streaming MIDI response body", err)
		return
	}
}

func (app *App) uploadMidiHandler(w http.ResponseWriter, r *http.Request) {
	if !checkInternalAPISecret(r) {
		app.writeError(w, r, http.StatusForbidden, "Forbidden", "missing or invalid internal API secret", nil)
		return
	}

	userId := r.URL.Query().Get("userId")
	if userId == "" {
		app.writeError(w, r, http.StatusBadRequest, "Bad request", "missing userId query parameter", nil)
		return
	}

	filePath := r.URL.Query().Get("filePath")
	if filePath == "" {
		app.writeError(w, r, http.StatusBadRequest, "Bad request", "missing filePath query parameter", nil)
		return
	}

	autoGenerateMusicXML := r.URL.Query().Get("isAutoGenerateMusicXML")

	// Grab MIDI file from request
	const MAX_FILE_SIZE = 10 << 20                              // 10 MB
	if err := r.ParseMultipartForm(MAX_FILE_SIZE); err != nil { // max file size stored in memory
		app.writeError(w, r, http.StatusBadRequest, "Failed to parse form", "failed to parse multipart form", err)
		return
	}

	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		app.writeError(w, r, http.StatusBadRequest, "Missing file", "multipart file field missing", err)
		return
	}
	if fileHeader.Size > MAX_FILE_SIZE {
		app.writeError(w, r, http.StatusBadRequest, fmt.Sprintf("File is too large (max size is %v)", uint(MAX_FILE_SIZE)>>20), "uploaded file exceeds max size", nil)
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
		app.writeError(w, r, http.StatusConflict, "File already exists", "MIDI object already exists in S3", nil)
		return
	} else if _, ok := errors.AsType[*types.NotFound](err); !ok {
		// If the error isn't a Not Found error then it's an actual error
		app.writeError(w, r, http.StatusInternalServerError, "Internal server error", "failed checking existing MIDI object in S3", err)
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
		app.writeError(w, r, http.StatusInternalServerError, "Internal server error", "failed uploading MIDI to S3", err)
		return
	}

	// Insert a row in the scores table now
	var scoreId string

	query := `
		INSERT INTO scores (user_id, title, file_path)
		VALUES ($1, $2, $3)
		RETURNING id;
	`

	err = app.db.QueryRow(r.Context(), query, userId, fileHeader.Filename, filePath).Scan(&scoreId)
	if err != nil {
		app.writeError(w, r, http.StatusInternalServerError, "Internal server error", "failed inserting score row", err)
		return
	}

	if autoGenerateMusicXML == "true" {
		// Send a message to the SQS queue to trigger the midi to musicxml conversion
		message := musicXMLConversionMessage{
			ScoreId: scoreId,
		}
		app.logger.Printf("Sending SQS message for MusicXML conversion: %+v", message)
		err = awscfg.SendMessage(r.Context(), app.queue, message)
		if err != nil {
			// If the SQS message fails to send, we should log the error but still proceed
			app.logger.Printf("Failed to send SQS message for MusicXML conversion: %v", err)
		}

		// Log queue message in DB
		query := `
			INSERT INTO conversions (score_id, status, midi_path)
			VALUES ($1, $2, $3);
		`
		_, err = app.db.Exec(r.Context(), query, scoreId, "queued", filePath)
		if err != nil {
			app.logger.Printf("Failed to log conversion queue message in DB: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	data := uploadMidiResponse{
		ScoreId: scoreId,
	}
	if err := json.NewEncoder(w).Encode(data); err != nil {
		app.writeError(w, r, http.StatusInternalServerError, "Internal Server Error", "failed to encode uploadMidi response", err)
		return
	}
}
