#!/bin/bash

# TrustBuild Backend Setup Script

echo "🚀 Setting up TrustBuild Backend..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js >= 18.0.0"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if ! npm list semver -g &> /dev/null; then
    echo "📦 Installing semver for version checking..."
    npm install -g semver
fi

if ! npx semver -r ">=$REQUIRED_VERSION" "$NODE_VERSION" &> /dev/null; then
    echo "❌ Node.js version $NODE_VERSION is not supported. Please install Node.js >= $REQUIRED_VERSION"
    exit 1
fi

echo "✅ Node.js version $NODE_VERSION is supported"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📄 Creating .env file from template..."
    cp env.example .env
    echo "⚠️  Please update your .env file with your actual configuration values:"
    echo "   - DATABASE_URL (Neon PostgreSQL)"
    echo "   - JWT_SECRET"
    echo "   - CLOUDINARY credentials"
    echo ""
    echo "📖 Refer to README.md for detailed setup instructions"
else
    echo "✅ .env file already exists"
fi

# Generate Prisma client
echo "🗄️  Generating Prisma client..."
npm run prisma:generate

# Check if database is accessible
echo "🔗 Checking database connection..."
if npm run prisma:migrate status &> /dev/null; then
    echo "✅ Database connection successful"
    
    # Run migrations
    echo "🏗️  Running database migrations..."
    npm run prisma:migrate || {
        echo "⚠️  Migration failed. Please check your DATABASE_URL in .env"
        echo "   Make sure your Neon PostgreSQL database is accessible"
    }
    
    # Ask if user wants to seed database
    read -p "🌱 Would you like to seed the database with sample data? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🌱 Seeding database..."
        npm run prisma:seed || {
            echo "⚠️  Seeding failed. You can run 'npm run prisma:seed' later"
        }
    fi
else
    echo "⚠️  Cannot connect to database. Please check your DATABASE_URL in .env"
    echo "   Make sure your Neon PostgreSQL database is accessible"
fi

echo ""
echo "🎉 Setup complete! Next steps:"
echo ""
echo "1. Update your .env file with your actual configuration"
echo "2. Run 'npm run dev' to start the development server"
echo "3. Visit http://localhost:5000/health to check server status"
echo ""
echo "📚 For more information, see README.md" 