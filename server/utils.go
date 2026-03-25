package main

import (
	"net/http"
	"os"
)

// checkInternalAPISecret checks the request for the correct internal API secret.
// It returns true if the secret is valid, and false if not.
func checkInternalAPISecret(r *http.Request) bool {
	secret := r.Header.Get("X-Internal-API-Secret")

	return secret == os.Getenv("INTERNAL_API_SECRET")
}
