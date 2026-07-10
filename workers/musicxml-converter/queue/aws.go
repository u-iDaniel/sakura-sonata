package queue

import (
	"context"
	"fmt"
	"os"
	"strconv"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	sqstypes "github.com/aws/aws-sdk-go-v2/service/sqs/types"
)

const (
	defaultRegion = "us-west-1"
)

type AWSQueue struct {
	sqsClient *sqs.Client
	queueURL  string
}

func NewSQSQueue(queueURL string) (*AWSQueue, error) {
	sqsClient, err := sqsClient(context.Background())
	if err != nil {
		return nil, err
	}

	return &AWSQueue{
		sqsClient: sqsClient,
		queueURL:  queueURL,
	}, nil
}

func sqsClient(ctx context.Context) (*sqs.Client, error) {
	region := os.Getenv("AWS_REGION")
	if region == "" {
		region = defaultRegion
	}

	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, err
	}

	return sqs.NewFromConfig(cfg), nil
}

// Actual queue functions
func (q *AWSQueue) ReceiveMessage(ctx context.Context) (Message, error) {
	messages, err := q.ReceiveMessages(ctx, 1)
	if err != nil {
		return Message{}, err
	}

	if len(messages) == 0 {
		return Message{}, nil
	}

	return messages[0], nil
}

func (q *AWSQueue) ReceiveMessages(ctx context.Context, maxNumber int32) ([]Message, error) {
	if maxNumber < 1 {
		maxNumber = 1
	}
	if maxNumber > 10 {
		maxNumber = 10
	}

	output, err := q.sqsClient.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
		QueueUrl:                    aws.String(q.queueURL),
		MaxNumberOfMessages:         maxNumber,
		WaitTimeSeconds:             20,
		MessageAttributeNames:       []string{"All"},
		MessageSystemAttributeNames: []sqstypes.MessageSystemAttributeName{sqstypes.MessageSystemAttributeNameApproximateReceiveCount},
	})
	if err != nil {
		return nil, err
	}

	messages := make([]Message, 0, len(output.Messages))
	for _, sqsMessage := range output.Messages {
		receiveCount := int32(1)
		if value, ok := sqsMessage.Attributes[string(sqstypes.MessageSystemAttributeNameApproximateReceiveCount)]; ok {
			if parsedCount, parseErr := strconv.Atoi(value); parseErr == nil && parsedCount > 0 {
				receiveCount = int32(parsedCount)
			}
		}

		messages = append(messages, Message{
			ID:                      aws.ToString(sqsMessage.MessageId),
			Body:                    aws.ToString(sqsMessage.Body),
			ReceiptHandle:           aws.ToString(sqsMessage.ReceiptHandle),
			ApproximateReceiveCount: receiveCount,
		})
	}

	return messages, nil
}

func (q *AWSQueue) DeleteMessage(ctx context.Context, message Message) error {
	if message.ReceiptHandle == "" {
		return fmt.Errorf("missing receipt handle for message %s", message.ID)
	}

	_, err := q.sqsClient.DeleteMessage(ctx, &sqs.DeleteMessageInput{
		QueueUrl:      aws.String(q.queueURL),
		ReceiptHandle: aws.String(message.ReceiptHandle),
	})
	if err != nil {
		return err
	}

	return nil
}
