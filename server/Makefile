.PHONY: build-lambda clean

all: build-lambda

clean:
	@echo "=> Cleaning up old build files..."
	rm -f bootstrap build/lambda.zip

build-lambda: clean
	@echo "=> Building Go binary for AWS Lambda (arm64)..."
	GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o bootstrap .

	@echo "=> Creating deployment package (lambda.zip)..."
	zip -r build/lambda.zip bootstrap certs/
	
	@echo "=> Removing temporary binary..."
	rm -f bootstrap
	
	@echo "=> Done! lambda.zip is ready."