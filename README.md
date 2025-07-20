# TrustBuild Backend API

A robust Node.js backend API for the TrustBuild platform built with Express, Prisma, PostgreSQL (Neon), and Cloudinary.

## 🚀 Features

- **Authentication & Authorization**: JWT-based auth with role-based access control
- **Database**: PostgreSQL with Prisma ORM (Neon cloud hosting)
- **File Uploads**: Cloudinary integration for images and documents
- **Security**: Helmet, CORS, rate limiting, input validation
- **API Documentation**: RESTful API design
- **Error Handling**: Comprehensive error handling and logging
- **TypeScript**: Full TypeScript support

## 📋 Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- Neon PostgreSQL account
- Cloudinary account

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   - Copy `env.example` to `.env`
   - Fill in your environment variables:

   ```env
   # Database Configuration (Neon PostgreSQL)
   DATABASE_URL="postgresql://username:password@your-neon-hostname.neon.tech/dbname?sslmode=require"

   # Server Configuration
   PORT=3000
   NODE_ENV=development

   # JWT Configuration
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   JWT_EXPIRES_IN=7d

   # Cloudinary Configuration
   CLOUDINARY_CLOUD_NAME=your-cloudinary-cloud-name
   CLOUDINARY_API_KEY=your-cloudinary-api-key
   CLOUDINARY_API_SECRET=your-cloudinary-api-secret

   # Frontend URL
   FRONTEND_URL=http://localhost:3000
   ```

4. **Database Setup**
   ```bash
   # Generate Prisma client
   npm run prisma:generate

   # Run database migrations
   npm run prisma:migrate

   # (Optional) Seed database
   npm run prisma:seed
   ```

5. **Start Development Server**
   ```bash
   npm run dev
   ```

## 🗂️ Project Structure

```
backend/
├── prisma/
│   ├── schema.prisma        # Database schema
│   └── migrations/          # Database migrations
├── src/
│   ├── config/
│   │   ├── database.ts      # Prisma client configuration
│   │   └── cloudinary.ts    # Cloudinary configuration
│   ├── middleware/
│   │   ├── auth.ts          # Authentication middleware
│   │   ├── errorHandler.ts  # Error handling middleware
│   │   └── notFoundHandler.ts
│   ├── routes/
│   │   ├── auth.ts          # Authentication routes
│   │   ├── users.ts         # User management routes
│   │   ├── contractors.ts   # Contractor routes
│   │   ├── customers.ts     # Customer routes
│   │   ├── jobs.ts          # Job posting routes
│   │   ├── reviews.ts       # Review routes
│   │   ├── upload.ts        # File upload routes
│   │   └── admin.ts         # Admin routes
│   └── index.ts             # Main application entry point
├── package.json
├── tsconfig.json
└── README.md
```

## 🔗 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user
- `PATCH /api/auth/update-password` - Update password

### Users
- `GET /api/users` - Get all users (Admin only)
- `GET /api/users/:id` - Get user by ID
- `PATCH /api/users/:id` - Update user profile

### Contractors
- `GET /api/contractors` - Get all contractors
- `GET /api/contractors/:id` - Get contractor by ID
- `PATCH /api/contractors/:id` - Update contractor profile
- `POST /api/contractors/:id/documents` - Upload contractor documents

### Jobs
- `GET /api/jobs` - Get all jobs
- `POST /api/jobs` - Create new job
- `GET /api/jobs/:id` - Get job by ID
- `PATCH /api/jobs/:id` - Update job
- `DELETE /api/jobs/:id` - Delete job
- `POST /api/jobs/:id/apply` - Apply for job

### Reviews
- `GET /api/reviews` - Get reviews
- `POST /api/reviews` - Create review
- `GET /api/reviews/:id` - Get review by ID

### Upload
- `POST /api/upload/image` - Upload image
- `POST /api/upload/document` - Upload document
- `DELETE /api/upload/:publicId` - Delete uploaded file

### Admin
- `GET /api/admin/stats` - Get platform statistics
- `GET /api/admin/contractors/pending` - Get pending contractor approvals
- `PATCH /api/admin/contractors/:id/approve` - Approve contractor
- `PATCH /api/admin/contractors/:id/reject` - Reject contractor

## 🔐 Authentication

The API uses JWT (JSON Web Tokens) for authentication. Include the token in requests using:

**Header:**
```
Authorization: Bearer <your-jwt-token>
```

**Cookie:**
```
jwt=<your-jwt-token>
```

## 🛡️ Security Features

- **Helmet**: Security headers
- **CORS**: Cross-origin resource sharing
- **Rate Limiting**: Request rate limiting
- **Input Validation**: Request data validation
- **Password Hashing**: bcrypt password hashing
- **JWT**: Secure token-based authentication

## 📊 Database Schema

The application uses the following main entities:

- **User**: Base user information
- **Customer**: Customer-specific data
- **Contractor**: Contractor profiles and verification
- **Job**: Job postings and management
- **JobApplication**: Contractor applications to jobs
- **Review**: Customer reviews and ratings
- **Service**: Available services
- **PortfolioItem**: Contractor portfolio items
- **ContractorDocument**: Verification documents

## 🌐 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Neon PostgreSQL connection string | Yes |
| `JWT_SECRET` | JWT signing secret | Yes |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name | Yes |
| `CLOUDINARY_API_KEY` | Cloudinary API key | Yes |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret | Yes |
| `PORT` | Server port | No (default: 3000) |
| `NODE_ENV` | Environment mode | No (default: development) |
| `FRONTEND_URL` | Frontend application URL | No (default: http://localhost:3000) |

## 📱 Development

### Running in Development Mode
```bash
npm run dev
```

### Building for Production
```bash
npm run build
npm start
```

### Database Commands
```bash
# Generate Prisma client
npm run prisma:generate

# Create migration
npm run prisma:migrate

# Deploy migrations
npm run prisma:deploy

# Open Prisma Studio
npm run prisma:studio

# Seed database
npm run prisma:seed
```

## 🚀 Deployment

### Environment Setup
1. Set up Neon PostgreSQL database
2. Configure Cloudinary account
3. Set all environment variables
4. Run database migrations

### Build and Deploy
```bash
npm run build
npm run prisma:deploy
npm start
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support, email support@trustbuild.com or create an issue in the repository. 