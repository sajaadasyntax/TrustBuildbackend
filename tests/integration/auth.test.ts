/**
 * Integration tests for Authentication API
 */

import request from 'supertest';
import express from 'express';
import {
  prisma,
  cleanDatabase,
  createTestUser,
  integrationTestSetup,
} from './setup';

// Note: In a real scenario, you'd import your actual Express app
// For this example, we'll create a minimal mock setup
const app = express();
app.use(express.json());

// Mock routes for demonstration
app.post('/api/auth/login', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );

  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

app.post('/api/auth/register', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { email, password, name, role } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(400).json({ error: 'User already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      role: role || 'CUSTOMER',
      emailVerified: false,
    },
  });

  res.status(201).json({ user: { id: user.id, email: user.email } });
});

describe('Authentication API Integration Tests', () => {
  beforeAll(integrationTestSetup.beforeAll);
  beforeEach(integrationTestSetup.beforeEach);
  afterAll(integrationTestSetup.afterAll);

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      // Arrange
      await createTestUser({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
        role: 'CUSTOMER',
      });

      // Act
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body.user).toMatchObject({
        email: 'test@example.com',
        role: 'CUSTOMER',
      });
    });

    it('should reject invalid credentials', async () => {
      await createTestUser({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
        role: 'CUSTOMER',
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject non-existent user', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(401);
    });

    it('should handle missing credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/auth/register', () => {
    it('should register new user successfully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'password123',
          name: 'New User',
          role: 'CUSTOMER',
        });

      expect(response.status).toBe(201);
      expect(response.body.user).toMatchObject({
        email: 'newuser@example.com',
      });

      // Verify user was created in database
      const user = await prisma.user.findUnique({
        where: { email: 'newuser@example.com' },
      });
      expect(user).toBeTruthy();
      expect(user?.emailVerified).toBe(false);
    });

    it('should reject duplicate email', async () => {
      await createTestUser({
        email: 'existing@example.com',
        password: 'password123',
        name: 'Existing User',
        role: 'CUSTOMER',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'existing@example.com',
          password: 'newpassword',
          name: 'Another User',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should hash password before storing', async () => {
      const plainPassword = 'mySecurePassword123';
      
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'secure@example.com',
          password: plainPassword,
          name: 'Secure User',
        });

      const user = await prisma.user.findUnique({
        where: { email: 'secure@example.com' },
      });

      expect(user?.password).not.toBe(plainPassword);
      expect(user?.password.length).toBeGreaterThan(20); // Bcrypt hash is long
    });
  });
});

