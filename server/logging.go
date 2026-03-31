package main

import (
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

type loggingResponseWriter struct {
	http.ResponseWriter
	statusCode   int
	bytesWritten int
}

func newLoggingResponseWriter(w http.ResponseWriter) *loggingResponseWriter {
	return &loggingResponseWriter{
		ResponseWriter: w,
		statusCode:     http.StatusOK,
	}
}

func (lrw *loggingResponseWriter) WriteHeader(statusCode int) {
	lrw.statusCode = statusCode
	lrw.ResponseWriter.WriteHeader(statusCode)
}

func (lrw *loggingResponseWriter) Write(data []byte) (int, error) {
	bytesWritten, err := lrw.ResponseWriter.Write(data)
	lrw.bytesWritten += bytesWritten
	return bytesWritten, err
}

func (app *App) loggingMiddleware(next http.Handler) http.Handler {
	logger := app.logger
	if logger == nil {
		logger = log.Default()
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		lrw := newLoggingResponseWriter(w)

		next.ServeHTTP(lrw, r)

		pattern := r.Pattern
		if pattern == "" {
			pattern = "unknown"
		}

		logger.Printf(
			"request method=%s path=%s pattern=%q status=%d bytes=%d duration_ms=%d remote_ip=%s request_id=%q user_agent=%q",
			r.Method,
			r.URL.Path,
			pattern,
			lrw.statusCode,
			lrw.bytesWritten,
			time.Since(start).Milliseconds(),
			clientIP(r),
			requestID(r),
			r.UserAgent(),
		)
	})
}

func clientIP(r *http.Request) string {
	forwardedFor := r.Header.Get("X-Forwarded-For")
	if forwardedFor != "" {
		first := strings.TrimSpace(strings.Split(forwardedFor, ",")[0])
		if first != "" {
			return first
		}
	}

	if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" {
		return realIP
	}

	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil {
		return host
	}

	return strings.TrimSpace(r.RemoteAddr)
}

func requestID(r *http.Request) string {
	if requestID := strings.TrimSpace(r.Header.Get("X-Request-Id")); requestID != "" {
		return requestID
	}

	if requestID := strings.TrimSpace(r.Header.Get("X-Amzn-Trace-Id")); requestID != "" {
		return requestID
	}

	return ""
}

func (app *App) writeError(w http.ResponseWriter, r *http.Request, statusCode int, clientMessage string, logMessage string, err error) {
	logger := app.logger
	if logger == nil {
		logger = log.Default()
	}

	if err != nil {
		logger.Printf(
			"error method=%s path=%s pattern=%q status=%d remote_ip=%s request_id=%q message=%q err=%v",
			r.Method,
			r.URL.Path,
			r.Pattern,
			statusCode,
			clientIP(r),
			requestID(r),
			logMessage,
			err,
		)
	} else {
		logger.Printf(
			"error method=%s path=%s pattern=%q status=%d remote_ip=%s request_id=%q message=%q",
			r.Method,
			r.URL.Path,
			r.Pattern,
			statusCode,
			clientIP(r),
			requestID(r),
			logMessage,
		)
	}

	http.Error(w, clientMessage, statusCode)
}
