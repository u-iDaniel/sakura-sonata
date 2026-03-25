package main

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/u-iDaniel/sakura-sonata/db"
)

type App struct {
	mux http.ServeMux // mux is the router essentially
	db  *pgx.Conn
}

func main() {
	app := App{
		mux: *http.NewServeMux(),
		db:  db.New(),
	}

	defer app.db.Close(context.Background())

	// Declare routes here
	app.mux.HandleFunc("GET /v1/music/score", app.getScoreHandler)
	app.mux.HandleFunc("GET /v1/music/scores", app.getScoresHandler)

	http.ListenAndServe(":8080", &app.mux)
}
