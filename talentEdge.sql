-- Campus Placement Assessment Portal (TalentEdge)
-- MySQL Database Schema Definition (DDL)

CREATE DATABASE IF NOT EXISTS talentedge;
USE talentedge;

-- 1. Batches Table
CREATE TABLE IF NOT EXISTS Batches (
    id VARCHAR(191) PRIMARY KEY,
    name VARCHAR(191) NOT NULL,
    college VARCHAR(191) NOT NULL,
    trainer VARCHAR(191) NOT NULL,
    totalStudents INT DEFAULT 0,
    readyCount INT DEFAULT 0,
    atRiskCount INT DEFAULT 0,
    averageScore DOUBLE DEFAULT 0.0,
    currentDay INT DEFAULT 1,
    startDate VARCHAR(191) NOT NULL,
    completionDate VARCHAR(191) NOT NULL,
    attendanceRate DOUBLE DEFAULT 100.0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Users Table
CREATE TABLE IF NOT EXISTS Users (
    id VARCHAR(191) PRIMARY KEY,
    name VARCHAR(191) NOT NULL,
    email VARCHAR(191) UNIQUE NOT NULL,
    role ENUM('admin', 'trainer', 'student') DEFAULT 'student',
    avatar TEXT NOT NULL,
    phone VARCHAR(50),
    rollNo VARCHAR(191) UNIQUE,
    college VARCHAR(191),
    department VARCHAR(191),
    branch VARCHAR(191),
    batchId VARCHAR(191),
    trainerName VARCHAR(191),
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batchId) REFERENCES Batches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. StudentProfiles Table (1-to-1 extension of Users)
CREATE TABLE IF NOT EXISTS StudentProfiles (
    id VARCHAR(191) PRIMARY KEY,
    attendancePercent DOUBLE DEFAULT 100.0,
    currentDay INT DEFAULT 1,
    overallProgressPercent DOUBLE DEFAULT 0.0,
    placementReadinessScore DOUBLE DEFAULT 0.0,
    
    -- Sub-domain Metrics
    coding DOUBLE DEFAULT 0.0,
    aptitude DOUBLE DEFAULT 0.0,
    reasoning DOUBLE DEFAULT 0.0,
    sqlScore DOUBLE DEFAULT 0.0,
    csFundamentals DOUBLE DEFAULT 0.0,
    communication DOUBLE DEFAULT 0.0,
    techInterview DOUBLE DEFAULT 0.0,
    hrInterview DOUBLE DEFAULT 0.0,
    overallReadiness DOUBLE DEFAULT 0.0,
    
    -- JSON blobs for complex properties
    eligibilityJson TEXT NOT NULL,
    weakAreasJson TEXT NOT NULL,
    strengthsJson TEXT NOT NULL,
    recentRemarksJson TEXT NOT NULL,
    
    batchId VARCHAR(191),
    FOREIGN KEY (id) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (batchId) REFERENCES Batches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. InterviewRecords Table
CREATE TABLE IF NOT EXISTS InterviewRecords (
    id VARCHAR(191) PRIMARY KEY,
    studentId VARCHAR(191) NOT NULL,
    type ENUM('tech', 'hr') NOT NULL,
    date VARCHAR(191) NOT NULL,
    panel VARCHAR(191) NOT NULL,
    status VARCHAR(100) DEFAULT 'Scheduled',
    ratingsJson TEXT NOT NULL,
    remarks TEXT NOT NULL,
    recommendation VARCHAR(100) DEFAULT 'Borderline',
    FOREIGN KEY (studentId) REFERENCES StudentProfiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Assessments Table
CREATE TABLE IF NOT EXISTS Assessments (
    id VARCHAR(191) PRIMARY KEY,
    dayNumber INT NOT NULL,
    title VARCHAR(191) NOT NULL,
    type VARCHAR(100) NOT NULL,
    durationMinutes INT NOT NULL,
    totalMarks INT NOT NULL,
    coverageJson TEXT NOT NULL,
    purpose VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'upcoming',
    scheduledDate VARCHAR(191) NOT NULL,
    sectionsJson TEXT NOT NULL,
    targetCompaniesJson TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Submissions Table
CREATE TABLE IF NOT EXISTS Submissions (
    id VARCHAR(191) PRIMARY KEY,
    assessmentId VARCHAR(191) NOT NULL,
    studentId VARCHAR(191) NOT NULL,
    score DOUBLE NOT NULL,
    totalMarks INT NOT NULL,
    percentage DOUBLE NOT NULL,
    timeSpentSeconds INT NOT NULL,
    submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    answersJson TEXT NOT NULL,
    codingResultsJson TEXT,
    passed TINYINT(1) DEFAULT 0,
    FOREIGN KEY (assessmentId) REFERENCES Assessments(id) ON DELETE CASCADE,
    FOREIGN KEY (studentId) REFERENCES Users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Notifications Table
CREATE TABLE IF NOT EXISTS Notifications (
    id VARCHAR(191) PRIMARY KEY,
    title VARCHAR(191) NOT NULL,
    time VARCHAR(191) NOT NULL,
    `desc` TEXT NOT NULL,
    unread TINYINT(1) DEFAULT 1,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;