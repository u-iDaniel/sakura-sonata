package storage

// Bucket for storing files (e.g. MusicXML files)
type Storage interface {
	Fetch(filePath string) ([]byte, error)
	Upload(filePath string, file []byte) error
}
