.PHONY: build clean

EXTENSION_NAME=cpark_extension
ZIP_FILE=$(EXTENSION_NAME).zip
FILES=manifest.json background.js popup.html popup.css popup.js icons

build:
	@echo "Building extension..."
	@mkdir -p dist
	@cp manifest.json dist/
	@cp background.js dist/
	@cp popup.html dist/
	@cp popup.css dist/
	@cp popup.js dist/
	@cp -r icons dist/
	@mkdir -p dist/libs
	@cp -r libs dist/
	@echo "Build complete in dist/"

zip: build
	@echo "Zipping extension..."
	@cd dist && zip -r ../$(ZIP_FILE) .
	@echo "Zip created at $(ZIP_FILE)"

clean:
	@rm -rf dist $(ZIP_FILE)
