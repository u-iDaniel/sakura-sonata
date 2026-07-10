package storage

import (
	"bytes"
	"context"
	"errors"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const (
	defaultRegion = "us-west-1"
)

type AWSStorage struct {
	s3Client   *s3.Client
	bucketName string
}

func NewS3Storage(bucketName string) (*AWSStorage, error) {
	s3Client, err := s3Client(context.Background())
	if err != nil {
		return nil, err
	}

	return &AWSStorage{
		s3Client,
		bucketName,
	}, nil
}

func s3Client(ctx context.Context) (*s3.Client, error) {
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

// Actual storage functions
func (s *AWSStorage) Fetch(filePath string) ([]byte, error) {
	params := &s3.GetObjectInput{
		Bucket: &s.bucketName,
		Key:    &filePath,
	}

	resp, err := s.s3Client.GetObject(context.Background(), params)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(resp.Body)
	if err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}

func (s *AWSStorage) Upload(filePath string, file []byte) error {
	// Check if the file already exists in the bucket
	_, err := s.s3Client.HeadObject(context.Background(), &s3.HeadObjectInput{
		Bucket: &s.bucketName,
		Key:    &filePath,
	})
	if err == nil {
		return nil // File already exists, no need to upload
	} else if _, ok := errors.AsType[*types.NotFound](err); !ok {
		return err // If the error is not a not found error then it's an actual error
	}

	// Upload the file to S3
	params := &s3.PutObjectInput{
		Bucket: &s.bucketName,
		Key:    &filePath,
		Body:   bytes.NewReader(file),
	}

	_, err = s.s3Client.PutObject(context.Background(), params)
	return err
}
