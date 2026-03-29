package awscfg

import (
	"context"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const (
	defaultRegion     = "us-west-1"
	defaultMidiBucket = "ss-midi"
)

func NewS3Client(ctx context.Context) (*s3.Client, error) {
	region := os.Getenv("AWS_REGION")
	if region == "" {
		region = defaultRegion
	}

	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, err
	}

	return s3.NewFromConfig(cfg), nil
}

func MidiBucketName() string {
	bucket := os.Getenv("S3_MIDI_BUCKET")
	if bucket == "" {
		return defaultMidiBucket
	}

	return bucket
}
