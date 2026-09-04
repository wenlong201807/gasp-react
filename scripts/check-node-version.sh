#!/bin/bash

REQUIRED_NODE="20.11.0"
CURRENT_NODE=$(node -v | cut -d'v' -f2)

if [ "$CURRENT_NODE" != "$REQUIRED_NODE" ]; then
    echo "❌ Node version mismatch!"
    echo "   Required: $REQUIRED_NODE"
    echo "   Current:  $CURRENT_NODE"
    echo ""
    echo "Run: nvm use"
    exit 1
fi

echo "✅ Node version: $CURRENT_NODE"
