#!/bin/bash

# Check if the server is running
PID=$(lsof -t -i:3000)
if [ -n "$PID" ]; then
  echo "Stopping existing server (PID: $PID)..."
  kill $PID
  sleep 2
  
  # Check if it's still running and force kill if necessary
  if [ -n "$(lsof -t -i:3000)" ]; then
    echo "Force killing server..."
    kill -9 $PID
  fi
fi

# Start the server
echo "Starting server..."
npm run dev &

echo "Server restarted successfully!"
