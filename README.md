# HYDRO – Incident Reporting & Ticket Management System

A role-based incident reporting and task management system built with Firebase, designed to simulate real-world IT support workflows.

🔗 **Live Demo:** https://hydrodigital.firebaseapp.com  
🔒 *Note: Role-based access is not publicly shared for security reasons (authentication + admin TOTP). Screenshots below demonstrate full system functionality.*

---

## Overview

HYDRO is a web-based system where users can report issues, administrators can review and assign tasks, and maintenance staff can track and complete work.

The system follows a structured workflow similar to real IT helpdesk or ticketing systems, focusing on issue tracking, role-based access, and task lifecycle management.

---

## How It Works

1. A user submits an incident report  
2. An admin reviews and assigns the task  
3. Maintenance staff accepts and works on the task  
4. Task progresses through defined statuses until completion  

**Task lifecycle:**
assigned → accepted → in_progress → completed

---

## IT Support Relevance

This project reflects common IT support operations:

- Incident intake and tracking (similar to helpdesk systems)
- Role-based access for users, admins, and technicians
- Task assignment and resolution workflow
- Status tracking and operational visibility
- Basic system security and access control

**Skills demonstrated:**
- Troubleshooting mindset (issue → diagnosis → resolution)
- Understanding of support workflows and ticketing systems
- User access management and system roles
- Working with cloud-based systems and deployments

---

## Features

### Core Functionality
- Incident reporting system
- Role-based dashboards (student, admin, maintenance, super_admin)
- Task assignment and lifecycle tracking
- Announcement system
- Analytics dashboard

### Security & System Design
- Firebase Authentication
- Firestore security rules
- Role-based access control
- Rate limiting and login protection
- Audit logging
- Firebase App Check

### Backend & Infrastructure
- Cloud Functions for backend logic
- Firestore database for real-time data
- Firebase Storage for file handling
- Firebase Hosting for deployment

---

## Screenshots

### Student Dashboard
![Student Dashboard](docs/screenshots/student-dashboard.png)

### Admin Dashboard
![Admin Dashboard](docs/screenshots/admin-dashboard.png)

### Maintenance Dashboard
![Maintenance Dashboard](docs/screenshots/maintenance-dashboard.png)

### Submit Incident Report
![Submit Report](docs/screenshots/submit-report.png)

---

## Tech Stack

- **Frontend:** JavaScript, HTML, CSS  
- **Backend:** Firebase Cloud Functions  
- **Database:** Firestore  
- **Authentication:** Firebase Auth  
- **Hosting:** Firebase Hosting  
- **Storage:** Firebase Storage  

---

## Project Structure

public/     → Frontend files
functions/  → Backend (Cloud Functions)
dist/       → Build output
docs/       → Documentation & screenshots
scripts/    → Build and deployment scripts

---

## My Contribution

- Designed the system workflow and user roles  
- Structured Firebase backend (Auth, Firestore, Functions)  
- Implemented and tested security rules  
- Debugged and validated system behavior across roles  
- Deployed and maintained the live system  

---

## Documentation

Detailed documentation is available in the `/docs` folder:

- system-overview.md  
- setup-and-deployment.md  
- technical-documentation.pdf  

---

## Why I Built This

I wanted to create a system that reflects how real-world issue tracking and task management works in operational environments.

This project helped me understand how users, administrators, and technicians interact within a system, and how issues move from reporting to resolution.

---

## Setup & Deployment

See full instructions in:
docs/setup-and-deployment.md

---

## Notes

- The system uses real authentication and role-based access  
- Admin-level access includes additional security (TOTP)  
- Public demo accounts are not provided for security reasons  

---

## Summary

HYDRO is a practical system that demonstrates:
- Real-world workflow design  
- Role-based access control  
- Task lifecycle management  
- Deployment and system validation  
