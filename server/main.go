package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
	"github.com/jackc/pgx/v5"
	_ "github.com/joho/godotenv/autoload"
	awscfg "github.com/u-iDaniel/sakura-sonata/aws"
	"github.com/u-iDaniel/sakura-sonata/db"
)

type App struct {
	mux        http.ServeMux // mux is the router essentially
	db         *pgx.Conn
	s3         *s3.Client
	midiBucket string
	queue      *sqs.Client
	logger     *log.Logger
}

func main() {
	s3Client, err := awscfg.NewS3Client(context.Background())
	if err != nil {
		log.Fatalf("failed to initialize AWS S3 client: %v", err)
	}

	sqsClient, err := awscfg.NewSQSClient(context.Background())
	if err != nil {
		log.Fatalf("failed to initialize AWS SQS client: %v", err)
	}

	app := App{
		mux:        *http.NewServeMux(),
		db:         db.New(),
		s3:         s3Client,
		midiBucket: awscfg.MidiBucketName(),
		queue:      sqsClient,
		logger:     log.Default(),
	}

	defer app.db.Close(context.Background())

	// Declare routes here
	app.mux.HandleFunc("GET /v1/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	app.mux.HandleFunc("GET /v1/music/score", app.getScoreHandler)
	app.mux.HandleFunc("DELETE /v1/music/score", app.deleteScoreHandler)
	app.mux.HandleFunc("GET /v1/music/scores", app.getScoresHandler)
	app.mux.HandleFunc("GET /v1/storage/midi", app.getMidiHandler)
	app.mux.HandleFunc("POST /v1/storage/midi", app.uploadMidiHandler)

	handler := app.loggingMiddleware(&app.mux)

	if os.Getenv("AWS_LAMBDA_FUNCTION_NAME") != "" {
		// Running within AWS Lambda
		log.Println("Server is running within AWS Lambda")
		lambda.Start(httpadapter.NewV2(handler).ProxyWithContext) // NewV2 is for lambda function urls or api gateway HTTP APIs
		return
	}

	log.Println("Server is running on port 8080")
	if err := http.ListenAndServe(":8080", handler); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
