package main

import (
	"os"
	"os/exec"
)

func ConvertWithMusescore(inputFilePath, outputFilePath string) error {
	cmd := exec.Command("mscore", inputFilePath, "-o", outputFilePath)
	cmd.Env = append(os.Environ(), "QT_QPA_PLATFORM=offscreen") // required to run MuseScore in headless mode

	return cmd.Run()
}
