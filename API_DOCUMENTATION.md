# TrustBuild API Documentation

Complete CRUD API endpoints for the TrustBuild platform.

## Base URL
```
http://localhost:3000/api
```

## Authentication
Most endpoints require JWT authentication. Include the token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

---

## 📋 Table of Contents

1. [Authentication Routes](#authentication-routes)
2. [User Routes](#user-routes) 
3. [Contractor Routes](#contractor-routes)
4. [Customer Routes](#customer-routes)
5. [Job Routes](#job-routes)
6. [Review Routes](#review-routes)
7. [Service Routes](#service-routes)
8. [Admin Routes](#admin-routes)
9. [Upload Routes](#upload-routes)

---

## 🔐 Authentication Routes

### Register User
```http
POST /api/auth/register
```
**Body:**
```json
{
  "name": "John Smith",
  "email": "john@example.com",
  "password": "password123",
  "role": "CUSTOMER"
}
```

### Login User
```http
POST /api/auth/login
```
**Body:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

### Refresh Token
```http
POST /api/auth/refresh
```
**Body:**
```json
{
  "refreshToken": "your_refresh_token"
}
```

### Logout
```http
POST /api/auth/logout
```
**Headers:** `Authorization: Bearer <token>`

### Forgot Password
```http
POST /api/auth/forgot-password
```
**Body:**
```json
{
  "email": "john@example.com"
}
```

### Reset Password
```http
POST /api/auth/reset-password/:token
```
**Body:**
```json
{
  "password": "newpassword123"
}
```

---

## 👤 User Routes

### Get All Users (Admin Only)
```http
GET /api/users?page=1&limit=10
```
**Headers:** `Authorization: Bearer <admin_token>`

### Get Current User Profile
```http
GET /api/users/me
```
**Headers:** `Authorization: Bearer <token>`

### Update Current User Profile
```http
PATCH /api/users/me
```
**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "name": "Updated Name",
  "email": "newemail@example.com"
}
```

### Update Password
```http
PATCH /api/users/me/password
```
**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword123",
  "confirmNewPassword": "newpassword123"
}
```

### Deactivate Account
```http
DELETE /api/users/me
```
**Headers:** `Authorization: Bearer <token>`

### Get User by ID (Admin Only)
```http
GET /api/users/:id
```
**Headers:** `Authorization: Bearer <admin_token>`

### Update User (Admin Only)
```http
PATCH /api/users/:id
```
**Headers:** `Authorization: Bearer <admin_token>`
**Body:**
```json
{
  "name": "Updated Name",
  "email": "newemail@example.com",
  "role": "CONTRACTOR",
  "isActive": true
}
```

---

## 🔨 Contractor Routes

### Get All Contractors (Public)
```http
GET /api/contractors?page=1&limit=10&city=London&service=plumbing&rating=4
```

### Get Single Contractor (Public)
```http
GET /api/contractors/:id
```

### Create Contractor Profile
```http
POST /api/contractors
```
**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "businessName": "Smith Construction",
  "description": "Professional contractor with 10+ years experience",
  "city": "London",
  "phone": "+44 20 1234 5678"
}
```

### Update My Contractor Profile
```http
PATCH /api/contractors/me
```
**Headers:** `Authorization: Bearer <contractor_token>`

### Get My Contractor Profile
```http
GET /api/contractors/me
```
**Headers:** `Authorization: Bearer <contractor_token>`

### Delete My Contractor Profile
```http
DELETE /api/contractors/me
```
**Headers:** `Authorization: Bearer <contractor_token>`

### Add Portfolio Item
```http
POST /api/contractors/me/portfolio
```
**Headers:** `Authorization: Bearer <contractor_token>`
**Body:**
```json
{
  "title": "Modern Kitchen Renovation",
  "description": "Complete kitchen transformation with custom cabinets",
  "imageUrl": "https://example.com/image.jpg",
  "projectType": "Kitchen",
  "completedAt": "2024-01-15"
}
```

### Update Portfolio Item
```http
PATCH /api/contractors/me/portfolio/:itemId
```
**Headers:** `Authorization: Bearer <contractor_token>`

### Delete Portfolio Item
```http
DELETE /api/contractors/me/portfolio/:itemId
```
**Headers:** `Authorization: Bearer <contractor_token>`

### Approve Contractor (Admin Only)
```http
PATCH /api/contractors/:id/approve
```
**Headers:** `Authorization: Bearer <admin_token>`
**Body:**
```json
{
  "approved": true,
  "reason": "Profile meets all requirements"
}
```

---

## 🏠 Customer Routes

### Get All Customers (Admin Only)
```http
GET /api/customers?page=1&limit=10
```
**Headers:** `Authorization: Bearer <admin_token>`

### Get Single Customer
```http
GET /api/customers/:id
```
**Headers:** `Authorization: Bearer <token>`

### Create Customer Profile
```http
POST /api/customers
```
**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "phone": "+44 20 1234 5678",
  "address": "123 Customer Street",
  "city": "London", 
  "postcode": "SW1A 1AA"
}
```

### Update My Customer Profile
```http
PATCH /api/customers/me
```
**Headers:** `Authorization: Bearer <customer_token>`

### Get My Customer Profile
```http
GET /api/customers/me
```
**Headers:** `Authorization: Bearer <customer_token>`

### Delete My Customer Profile
```http
DELETE /api/customers/me
```
**Headers:** `Authorization: Bearer <customer_token>`

### Get My Customer Statistics
```http
GET /api/customers/me/stats
```
**Headers:** `Authorization: Bearer <customer_token>`

### Get Customer Dashboard Data
```http
GET /api/customers/me/dashboard
```
**Headers:** `Authorization: Bearer <customer_token>`

---

## 💼 Job Routes

### Get All Jobs (Public)
```http
GET /api/jobs?page=1&limit=10&category=plumbing&location=London
```

### Get Single Job (Public)
```http
GET /api/jobs/:id
```

### Create New Job
```http
POST /api/jobs
```
**Headers:** `Authorization: Bearer <customer_token>`
**Body:**
```json
{
  "title": "Kitchen Renovation Required",
  "description": "Looking for a complete kitchen renovation",
  "category": "Kitchen Renovation",
  "location": "London, SW1A 1AA",
  "budget": 15000
}
```

### Update Job
```http
PATCH /api/jobs/:id
```
**Headers:** `Authorization: Bearer <customer_token>`

### Delete Job
```http
DELETE /api/jobs/:id
```
**Headers:** `Authorization: Bearer <customer_token>`

### Apply for Job
```http
POST /api/jobs/:id/apply
```
**Headers:** `Authorization: Bearer <contractor_token>`
**Body:**
```json
{
  "proposal": "I have 10+ years experience in kitchen renovations...",
  "estimatedCost": 14500,
  "timeline": "3-4 weeks",
  "questions": "What appliances are you looking to include?"
}
```

### Get Job Applications
```http
GET /api/jobs/:id/applications
```
**Headers:** `Authorization: Bearer <customer_token>`

### Accept Job Application
```http
PATCH /api/jobs/:id/applications/:applicationId/accept
```
**Headers:** `Authorization: Bearer <customer_token>`

### Get My Posted Jobs (Customer)
```http
GET /api/jobs/my/posted
```
**Headers:** `Authorization: Bearer <customer_token>`

### Get My Applications (Contractor)
```http
GET /api/jobs/my/applications
```
**Headers:** `Authorization: Bearer <contractor_token>`

### Complete Job
```http
PATCH /api/jobs/:id/complete
```
**Headers:** `Authorization: Bearer <contractor_token>`

---

## ⭐ Review Routes

### Get Contractor Reviews (Public)
```http
GET /api/reviews/contractor/:contractorId?page=1&limit=10
```

### Create Review
```http
POST /api/reviews
```
**Headers:** `Authorization: Bearer <customer_token>`
**Body:**
```json
{
  "jobId": "job_id_here",
  "contractorId": "contractor_id_here",
  "rating": 5,
  "comment": "Excellent work, very professional"
}
```

### Update Review
```http
PATCH /api/reviews/:id
```
**Headers:** `Authorization: Bearer <customer_token>`

### Delete Review
```http
DELETE /api/reviews/:id
```
**Headers:** `Authorization: Bearer <token>`

### Respond to Review
```http
POST /api/reviews/:id/respond
```
**Headers:** `Authorization: Bearer <contractor_token>`
**Body:**
```json
{
  "response": "Thank you for the kind words! It was a pleasure working on your kitchen."
}
```

### Get My Given Reviews (Customer)
```http
GET /api/reviews/my/given
```
**Headers:** `Authorization: Bearer <customer_token>`

### Get My Received Reviews (Contractor)
```http
GET /api/reviews/my/received
```
**Headers:** `Authorization: Bearer <contractor_token>`

### Flag Review for Moderation
```http
POST /api/reviews/:id/flag
```
**Headers:** `Authorization: Bearer <token>`
**Body:**
```json
{
  "reason": "Inappropriate content"
}
```

### Get Flagged Reviews (Admin Only)
```http
GET /api/reviews/flagged
```
**Headers:** `Authorization: Bearer <admin_token>`

### Moderate Review (Admin Only)
```http
PATCH /api/reviews/:id/moderate
```
**Headers:** `Authorization: Bearer <admin_token>`
**Body:**
```json
{
  "action": "approve" // or "remove"
}
```

---

## 🛠️ Service Routes

### Get All Services (Public)
```http
GET /api/services?page=1&limit=50&category=Construction
```

### Get Single Service (Public)
```http
GET /api/services/:id
```

### Create Service (Admin Only)
```http
POST /api/services
```
**Headers:** `Authorization: Bearer <admin_token>`
**Body:**
```json
{
  "name": "Kitchen Renovation",
  "description": "Complete kitchen renovation services",
  "category": "Home Improvement",
  "isActive": true
}
```

### Update Service (Admin Only)
```http
PATCH /api/services/:id
```
**Headers:** `Authorization: Bearer <admin_token>`

### Delete Service (Admin Only)
```http
DELETE /api/services/:id
```
**Headers:** `Authorization: Bearer <admin_token>`

### Get Service Categories (Public)
```http
GET /api/services/categories
```

### Get Contractors for Service (Public)
```http
GET /api/services/:id/contractors?page=1&limit=10&location=London&rating=4&tier=PREMIUM
```

### Add Service to Contractor
```http
POST /api/services/:id/contractors/:contractorId
```
**Headers:** `Authorization: Bearer <token>`

### Remove Service from Contractor
```http
DELETE /api/services/:id/contractors/:contractorId
```
**Headers:** `Authorization: Bearer <token>`

---

## 👑 Admin Routes

### Get Dashboard Statistics
```http
GET /api/admin/dashboard
```
**Headers:** `Authorization: Bearer <admin_token>`

### Get Platform Analytics
```http
GET /api/admin/analytics?period=30
```
**Headers:** `Authorization: Bearer <admin_token>`

### Get Pending Contractor Approvals
```http
GET /api/admin/contractors/pending?page=1&limit=10
```
**Headers:** `Authorization: Bearer <admin_token>`

### Approve/Reject Contractor
```http
PATCH /api/admin/contractors/:id/approve
```
**Headers:** `Authorization: Bearer <admin_token>`
**Body:**
```json
{
  "approved": true,
  "reason": "Profile meets all requirements"
}
```

### Get Flagged Content
```http
GET /api/admin/content/flagged
```
**Headers:** `Authorization: Bearer <admin_token>`

### Moderate Content
```http
PATCH /api/admin/content/:type/:id/moderate
```
**Headers:** `Authorization: Bearer <admin_token>`
**Body:**
```json
{
  "action": "approve", // "approve", "reject", "delete"
  "reason": "Content is appropriate"
}
```

### Manage User Account
```http
PATCH /api/admin/users/:id/manage
```
**Headers:** `Authorization: Bearer <admin_token>`
**Body:**
```json
{
  "action": "activate" // "activate", "deactivate", "delete"
}
```

### Get System Settings
```http
GET /api/admin/payments/settings
```
**Headers:** `Authorization: Bearer <admin_token>`

### Update System Settings
```http
PATCH /api/admin/payments/settings
```
**Headers:** `Authorization: Bearer <admin_token>`
**Body:**
```json
{
  "settings": {
    "platform_fee": "5",
    "max_applications_per_job": "10",
    "review_moderation_enabled": "true"
  }
}
```

---

## 📤 Upload Routes

### Upload File
```http
POST /api/upload
```
**Headers:** `Authorization: Bearer <token>`
**Body:** `multipart/form-data`
```
file: [binary file data]
```

### Upload Multiple Files
```http
POST /api/upload/multiple
```
**Headers:** `Authorization: Bearer <token>`
**Body:** `multipart/form-data`
```
files: [multiple binary files]
```

---

## 🔄 Response Format

All API responses follow this consistent format:

### Success Response
```json
{
  "status": "success",
  "data": {
    // Response data here
  }
}
```

### Error Response
```json
{
  "status": "error",
  "message": "Error description"
}
```

### Paginated Response
```json
{
  "status": "success",
  "data": {
    "items": [/* Array of items */],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 100,
      "pages": 10
    }
  }
}
```

---

## 🚀 Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `422` - Validation Error
- `500` - Internal Server Error

---

## 📝 Notes

1. **Authentication**: Most endpoints require JWT authentication
2. **Pagination**: Use `page` and `limit` query parameters for paginated endpoints
3. **Filtering**: Many GET endpoints support filtering via query parameters
4. **File Uploads**: Use `multipart/form-data` for file uploads
5. **Admin Access**: Admin-only endpoints require `ADMIN` role
6. **Rate Limiting**: API includes rate limiting (100 requests per 15 minutes)
7. **CORS**: Configured for frontend domain access

---

## 🔧 Environment Variables

Required environment variables for the API:

```bash
DATABASE_URL="postgresql://..."
JWT_SECRET="your-secret-key"
JWT_REFRESH_SECRET="your-refresh-secret"
CLOUDINARY_CLOUD_NAME="your-cloud-name"
CLOUDINARY_API_KEY="your-api-key"
CLOUDINARY_API_SECRET="your-api-secret"
NODE_ENV="development"
PORT="3000"
``` 