# 🔐 Admin Login Guide

## Admin Login Credentials

### Super Admin
- **Email**: `superadmin@trustbuild.uk`
- **Password**: `SuperAdmin@2024!`
- **Role**: Full system access

### Finance Admin
- **Email**: `finance@trustbuild.uk`
- **Password**: `FinanceAdmin@2024!`
- **Role**: Payments, Invoices, Commissions

### Support Admin
- **Email**: `support@trustbuild.uk`
- **Password**: `SupportAdmin@2024!`
- **Role**: Users, Contractors, Jobs

## API Endpoints

### Admin Authentication
- **Base Path**: `/api/admin-auth`
- **Login**: `POST /api/admin-auth/login`
- **Get Profile**: `GET /api/admin-auth/me`
- **Enable 2FA**: `POST /api/admin-auth/2fa/enable`
- **Verify 2FA Setup**: `POST /api/admin-auth/2fa/verify-setup`
- **Disable 2FA**: `POST /api/admin-auth/2fa/disable`

### Regular User Authentication (NOT for Admins)
- **Base Path**: `/api/auth`
- **Login**: `POST /api/auth/login`
- **Register**: `POST /api/auth/register`

## Login Request Format

### Admin Login

```bash
curl -X POST https://api.trustbuild.uk/api/admin-auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "superadmin@trustbuild.uk",
    "password": "SuperAdmin@2024!"
  }'
```

### Successful Response

```json
{
  "status": "success",
  "data": {
    "admin": {
      "id": "xxx",
      "email": "superadmin@trustbuild.uk",
      "name": "Super Administrator",
      "role": "SUPER_ADMIN"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "requires2FA": false,
    "tempToken": null
  }
}
```

### Error Response

```json
{
  "status": "error",
  "message": "Invalid email or password"
}
```

## Frontend Integration

### Admin Login Page
The admin login page should call:

```javascript
const response = await fetch('https://api.trustbuild.uk/api/admin-auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
```

### Regular User Login Page
The regular user login should call:

```javascript
const response = await fetch('https://api.trustbuild.uk/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
```

## Common Mistakes

### ❌ Wrong Email Format
```
financeadmin@trustbuild.uk  ← WRONG
finance@trustbuild.uk       ← CORRECT
```

### ❌ Wrong Password
```
fFnanceAdmin@2024!  ← WRONG (typo: double 'f')
FinanceAdmin@2024!  ← CORRECT
```

### ❌ Wrong Endpoint
```
/api/auth/login        ← WRONG (for regular users)
/api/admin-auth/login  ← CORRECT (for admins)
```

### ❌ Wrong Login Page
```
https://www.trustbuild.uk/login        ← WRONG (for customers/contractors)
https://www.trustbuild.uk/admin/login  ← CORRECT (for admins)
```

## Testing Admin Login

### Using cURL

```bash
# Test Super Admin
curl -X POST http://localhost:5001/api/admin-auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"superadmin@trustbuild.uk","password":"SuperAdmin@2024!"}'

# Test Finance Admin
curl -X POST http://localhost:5001/api/admin-auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"finance@trustbuild.uk","password":"FinanceAdmin@2024!"}'

# Test Support Admin
curl -X POST http://localhost:5001/api/admin-auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"support@trustbuild.uk","password":"SupportAdmin@2024!"}'
```

### Using Postman

1. **Method**: POST
2. **URL**: `https://api.trustbuild.uk/api/admin-auth/login`
3. **Headers**: 
   - Content-Type: application/json
4. **Body** (raw JSON):
```json
{
  "email": "superadmin@trustbuild.uk",
  "password": "SuperAdmin@2024!"
}
```

## 2FA Login Flow

If 2FA is enabled for an admin:

### Step 1: Login with Email & Password
```bash
POST /api/admin-auth/login
{
  "email": "superadmin@trustbuild.uk",
  "password": "SuperAdmin@2024!"
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "requires2FA": true,
    "tempToken": "temp_xyz123..."
  }
}
```

### Step 2: Verify 2FA Code
```bash
POST /api/admin-auth/verify-2fa
{
  "tempToken": "temp_xyz123...",
  "token": "123456"  // 6-digit code from authenticator app
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "admin": {...},
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

## Security Best Practices

1. ✅ **Change default passwords** immediately after first login
2. ✅ **Enable 2FA** for all admin accounts
3. ✅ **Use HTTPS** in production (not HTTP)
4. ✅ **Store tokens securely** (httpOnly cookies or secure storage)
5. ✅ **Implement token refresh** for better security
6. ✅ **Log all admin actions** (already implemented via activity logs)

## Troubleshooting

### Error: "Invalid email or password"
- Check you're using the correct email (e.g., `finance@trustbuild.uk` not `financeadmin@trustbuild.uk`)
- Verify password is correct (case-sensitive)
- Ensure you're calling `/api/admin-auth/login` not `/api/auth/login`

### Error: "CORS error"
- Check CORS configuration in backend
- Ensure frontend domain is allowed
- Verify API URL is correct

### Error: "Network request failed"
- Check backend server is running
- Verify API URL and port
- Check firewall/network settings

### Success but can't access admin pages
- Verify token is being stored correctly
- Check authentication middleware
- Ensure admin role is being validated

## Frontend API Client Example

```typescript
// lib/adminApi.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.trustbuild.uk';

export const adminApi = {
  login: async (email: string, password: string) => {
    const response = await fetch(`${API_URL}/api/admin-auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Login failed');
    }
    
    return response.json();
  },
  
  getProfile: async (token: string) => {
    const response = await fetch(`${API_URL}/api/admin-auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch profile');
    }
    
    return response.json();
  },
};
```

## Notes

- Admin accounts are stored in the `admins` table (separate from regular users)
- Admin tokens have a different structure and permissions
- Admin authentication is completely separate from user authentication
- Each admin role has different permissions (checked via middleware)

---

**Last Updated**: October 16, 2025

