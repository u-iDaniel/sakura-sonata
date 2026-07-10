package queue

import "context"

type Queue interface {
	ReceiveMessage(ctx context.Context) (Message, error)
	ReceiveMessages(ctx context.Context, maxNumber int32) ([]Message, error)
	DeleteMessage(ctx context.Context, message Message) error
}

type Message struct {
	ID                      string
	Body                    string
	ReceiptHandle           string
	ApproximateReceiveCount int32
}
