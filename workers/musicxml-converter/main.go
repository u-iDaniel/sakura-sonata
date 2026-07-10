package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	_ "github.com/joho/godotenv/autoload"
	"github.com/u-iDaniel/sakura-sonata/workers/musicxml-converter/db"
	"github.com/u-iDaniel/sakura-sonata/workers/musicxml-converter/queue"
	"github.com/u-iDaniel/sakura-sonata/workers/musicxml-converter/storage"
)

const (
	midiBucketName     = "ss-midi"
	musicXMLBucketName = "ss-musicxml"
)

func main() {
	ctx := context.Background()
	var err error

	// DB
	var db *pgx.Conn = db.New()

	// S3 Buckets
	var midiStorage storage.Storage
	var musicXMLStorage storage.Storage

	// Queue
	var workerQueue queue.Queue

	// Initialize everything
	midiStorage, err = storage.NewS3Storage(midiBucketName)
	if err != nil {
		log.Default().Fatalf("Error initializing storage: %v", err)
	}

	musicXMLStorage, err = storage.NewS3Storage(musicXMLBucketName)
	if err != nil {
		log.Default().Fatalf("Error initializing storage: %v", err)
	}

	queueURL := os.Getenv("SQS_QUEUE_URL")
	if queueURL == "" {
		log.Default().Fatal("SQS_QUEUE_URL is not set")
	}

	workerQueue, err = queue.NewSQSQueue(queueURL)
	if err != nil {
		log.Default().Fatalf("Error initializing queue: %v", err)
	}

	// Health check api route here in a separate goroutine so it doesn't block the main loop
	go func() {
		port := ":8081"
		mux := http.NewServeMux()
		mux.HandleFunc("GET /health", healthHandler)

		log.Default().Printf("Health check listening on port %s", port)
		if err := http.ListenAndServe(port, mux); err != nil {
			log.Default().Fatalf("Error starting health check server: %v", err)
		}
	}()

	for {
		// 1. Collect messages from the SQS queue
		messages, err := workerQueue.ReceiveMessages(ctx, 10)
		if err != nil {
			log.Default().Fatalf("Error receiving queue messages: %v", err)
		}

		if len(messages) == 0 {
			time.Sleep(5 * time.Second)
			continue
		}

		for _, message := range messages {
			if err := processMessage(ctx, db, workerQueue, midiStorage, musicXMLStorage, message); err != nil {
				log.Default().Printf("Error processing message %s: %v", message.ID, err)
			}
		}
	}
}
