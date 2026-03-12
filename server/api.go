package main

import (
	"net/http"
	"os"
)

func (app *App) getScoreHandler(w http.ResponseWriter, r *http.Request) {
	// Check for secret to make sure people can't get other's data if they happen to know their user id (maybe move this section to middleware later)
	secret := r.Header.Get("X-Internal-API-Secret")

	if secret != os.Getenv("INTERNAL_API_SECRET") {
		http.Error(w, "Forbidden", http.StatusForbidden)
	}

	id := r.URL.Query().Get("id")

	if id == "" {
		// Return some 400 error here
	}

	var title string
}
