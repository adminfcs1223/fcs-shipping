#!/usr/bin/env bash
# One-time: download the two site photos into /assets so the site
# no longer depends on the old Squarespace site staying online.
# Run from the repo root:  bash scripts/fetch-assets.sh
set -e
mkdir -p assets
curl -L -o assets/hero-ship.jpg "https://images.squarespace-cdn.com/content/v1/616b4d41e2976800d6464843/1634424319096-P4E4TGE0QYU0Z5NG8ANX/cameron-venti-1cqIcrWFQBI-unsplash.jpg"
curl -L -o assets/operations.jpg "https://images.squarespace-cdn.com/content/v1/616b4d41e2976800d6464843/1634509851821-WLOO5WTH6YO3I0LYEAH3/IMG_3454.jpg"
echo "Done. Commit the assets folder:  git add assets && git commit -m 'Add photos'"
