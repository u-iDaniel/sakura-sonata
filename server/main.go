package main

import (
	"context"
	"log"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	awscfg "github.com/u-iDaniel/sakura-sonata/aws"
	"github.com/u-iDaniel/sakura-sonata/db"
)

type App struct {
	mux        http.ServeMux // mux is the router essentially
	db         *pgx.Conn
	s3         *s3.Client
	midiBucket string
}

func main() {
	s3Client, err := awscfg.NewS3Client(context.Background())
	if err != nil {
		log.Fatalf("failed to initialize AWS S3 client: %v", err)
	}

	app := App{
		mux:        *http.NewServeMux(),
		db:         db.New(),
		s3:         s3Client,
		midiBucket: awscfg.MidiBucketName(),
	}

	defer app.db.Close(context.Background())

	// Declare routes here
	app.mux.HandleFunc("GET /v1/music/score", app.getScoreHandler)
	app.mux.HandleFunc("GET /v1/music/scores", app.getScoresHandler)
	app.mux.HandleFunc("GET /v1/storage/midi", app.getMidiHandler)

	http.ListenAndServe(":8080", &app.mux)
}
