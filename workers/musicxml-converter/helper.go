package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5"
	"github.com/u-iDaniel/sakura-sonata/workers/musicxml-converter/queue"
	"github.com/u-iDaniel/sakura-sonata/workers/musicxml-converter/storage"
)

const maxConversionAttempts = 3

type musicXMLConversionMessage struct {
	ScoreId string `json:"score_id"`
}

func processMessage(
	ctx context.Context,
	databaseConn *pgx.Conn,
	workerQueue queue.Queue,
	midiStorage storage.Storage,
	musicXMLStorage storage.Storage,
	message queue.Message,
) error {
	// 2. For each message, fetch the MIDI file from S3 via the DB record through score_id
	var conversionMessage musicXMLConversionMessage
	if err := json.Unmarshal([]byte(message.Body), &conversionMessage); err != nil {
		return fmt.Errorf("parsing queue message: %w", err)
	}

	if conversionMessage.ScoreId == "" {
		return fmt.Errorf("queue message %s is missing score_id", message.ID)
	}

	// 3. Mark the message as being processed in the DB
	if err := updateConversionStatus(ctx, databaseConn, conversionMessage.ScoreId, "processing"); err != nil {
		return handleConversionFailure(ctx, databaseConn, workerQueue, message, conversionMessage.ScoreId, false, err)
	}

	userId, midiPath, err := fetchScoreDetails(ctx, databaseConn, conversionMessage.ScoreId)
	if err != nil {
		return handleConversionFailure(ctx, databaseConn, workerQueue, message, conversionMessage.ScoreId, false, err)
	}

	midiFile, err := midiStorage.Fetch(midiPath)
	if err != nil {
		return handleConversionFailure(ctx, databaseConn, workerQueue, message, conversionMessage.ScoreId, false, fmt.Errorf("fetching MIDI file %q: %w", midiPath, err))
	}

	contentHash := sha256.Sum256(midiFile)
	musicXMLKey := buildMusicXMLKey(userId, hex.EncodeToString(contentHash[:]))
	musicXMLFileName := hex.EncodeToString(contentHash[:]) + ".musicxml"

	dir, err := os.MkdirTemp("", "conversion-*")
	if err != nil {
		return fmt.Errorf("creating temp directory: %w", err)
	}
	defer os.RemoveAll(dir)

	midiFilePath := filepath.Join(dir, filepath.Base(midiPath))
	if err := os.WriteFile(midiFilePath, midiFile, 0644); err != nil {
		return fmt.Errorf("writing MIDI file to temp directory: %w", err)
	}

	musicXMLFilePath := filepath.Join(dir, musicXMLFileName)

	// 4. Convert the MIDI file to MusicXML using MuseScore
	if err := ConvertWithMusescore(midiFilePath, musicXMLFilePath); err != nil {
		return handleConversionFailure(ctx, databaseConn, workerQueue, message, conversionMessage.ScoreId, false, fmt.Errorf("converting MIDI to MusicXML: %w", err))
	}

	musicXMLFile, err := os.ReadFile(musicXMLFilePath)
	if err != nil {
		return handleConversionFailure(ctx, databaseConn, workerQueue, message, conversionMessage.ScoreId, false, fmt.Errorf("reading converted MusicXML file: %w", err))
	}

	// 5. Upload the MusicXML file to S3 using the hash of the MIDI file as the key
	if err := musicXMLStorage.Upload(musicXMLKey, musicXMLFile); err != nil {
		return handleConversionFailure(ctx, databaseConn, workerQueue, message, conversionMessage.ScoreId, false, fmt.Errorf("uploading MusicXML file: %w", err))
	}

	// 6. Mark the message as completed in the DB
	if err := updateCompletedConversion(ctx, databaseConn, conversionMessage.ScoreId, musicXMLKey); err != nil {
		return err
	}

	// 7. Delete the message from the SQS queue
	if err := workerQueue.DeleteMessage(ctx, message); err != nil {
		return fmt.Errorf("deleting queue message: %w", err)
	}

	log.Default().Printf("Converted score %s to MusicXML successfully", conversionMessage.ScoreId)
	return nil
}

func handleConversionFailure(
	ctx context.Context,
	databaseConn *pgx.Conn,
	workerQueue queue.Queue,
	message queue.Message,
	scoreId string,
	uploaded bool,
	err error,
) error {
	if uploaded || message.ApproximateReceiveCount < maxConversionAttempts {
		return err
	}

	if updateErr := updateConversionStatus(ctx, databaseConn, scoreId, "failed"); updateErr != nil {
		return fmt.Errorf("marking conversion %s as failed after %d attempts: %w", scoreId, message.ApproximateReceiveCount, updateErr)
	}

	if deleteErr := workerQueue.DeleteMessage(ctx, message); deleteErr != nil {
		return fmt.Errorf("deleting failed queue message %s after %d attempts: %w", message.ID, message.ApproximateReceiveCount, deleteErr)
	}

	log.Default().Printf("Marked score %s as failed after %d attempts", scoreId, message.ApproximateReceiveCount)
	return nil
}

func fetchScoreDetails(ctx context.Context, databaseConn *pgx.Conn, scoreId string) (string, string, error) {
	var userId string
	var midiPath string
	query := `
		SELECT user_id, file_path
		FROM scores
		WHERE id = $1;
	`

	if err := databaseConn.QueryRow(ctx, query, scoreId).Scan(&userId, &midiPath); err != nil {
		return "", "", fmt.Errorf("fetching score details for %s: %w", scoreId, err)
	}

	return userId, midiPath, nil
}

func buildMusicXMLKey(userId, fileHash string) string {
	return fmt.Sprintf("%s/uploads/%s.musicxml", userId, fileHash)
}

func updateConversionStatus(ctx context.Context, databaseConn *pgx.Conn, scoreId, status string) error {
	query := `
		UPDATE conversions
		SET status = $2,
		    updated_at = CURRENT_TIMESTAMP
		WHERE score_id = $1;
	`

	_, err := databaseConn.Exec(ctx, query, scoreId, status)
	if err != nil {
		return fmt.Errorf("updating conversion status for score %s: %w", scoreId, err)
	}

	return nil
}

func updateCompletedConversion(ctx context.Context, databaseConn *pgx.Conn, scoreId, sheetPath string) error {
	query := `
		UPDATE conversions
		SET status = $2,
		    sheet_path = $3,
		    updated_at = CURRENT_TIMESTAMP
		WHERE score_id = $1;
	`

	_, err := databaseConn.Exec(ctx, query, scoreId, "completed", sheetPath)
	if err != nil {
		return fmt.Errorf("updating completed conversion for score %s: %w", scoreId, err)
	}

	return nil
}
