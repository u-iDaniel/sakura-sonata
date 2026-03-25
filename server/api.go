package main

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5"
)

type getScoreResponse struct {
	Id    string `json:"id"`
	Title string `json:"title"`
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
		WHERE id = $1
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
