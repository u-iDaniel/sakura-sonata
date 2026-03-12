package db

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5"
)

func New() *pgx.Conn {
	dbHost := os.Getenv("DB_HOST")
	dbUser := os.Getenv("DB_USERNAME")
	dbPass := os.Getenv("DB_PASSWORD")
	dbPort := os.Getenv("DB_PORT")

	// Verify full basically requires the public ssl root certificate from AWS to be here
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/postgres?sslmode=verify-full&sslrootcert=/certs/global-bundle.pem", dbUser, dbPass, dbHost, dbPort) // data source name (db url connection)

	conn, err := pgx.Connect(context.Background(), dsn)
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}

	defer conn.Close(context.Background())

	return conn
}
