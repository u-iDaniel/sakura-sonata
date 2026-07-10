package awscfg // I have no idea why I chose the awscfg package name but I guess we're sticking with it

import (
	"context"
	"encoding/json"
	"os"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

// Takes in a message that is a struct and marshals it into JSON
func SendMessage[T any](ctx context.Context, sqsClient *sqs.Client, message T) error {
	messageBody, err := json.Marshal(message)
	if err != nil {
		return err
	}

	params := &sqs.SendMessageInput{
		QueueUrl:    aws.String(os.Getenv("SQS_QUEUE_URL")),
		MessageBody: aws.String(string(messageBody)),
	}

	_, err = sqsClient.SendMessage(ctx, params)
	if err != nil {
		return err
	}

	return nil
}
