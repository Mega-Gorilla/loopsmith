# Simple User API Specification

## Overview
REST API for basic user management operations.

## Endpoints

### 1. GET /users
- **Description**: Retrieve all users
- **Response**: Array of user objects
- **Status Code**: 200 OK

### 2. GET /users/:id
- **Description**: Retrieve specific user
- **Parameters**: id (integer) - User ID
- **Response**: User object
- **Status Codes**: 
  - 200 OK - User found
  - 404 Not Found - User not found

### 3. POST /users
- **Description**: Create new user
- **Request Body**:
  ```json
  {
    "name": "string",
    "email": "string"
  }
  ```
- **Response**: Created user object
- **Status Code**: 201 Created

## Data Model

### User Object
```json
{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "created_at": "2024-01-01T00:00:00Z"
}
```

## Authentication
JWT tokens in Authorization header: `Bearer <token>`

## Error Handling
Standard HTTP status codes with error messages in response body.

## Implementation Notes
- Use Express.js for the server
- PostgreSQL for database
- Input validation with express-validator
- bcrypt for password hashing