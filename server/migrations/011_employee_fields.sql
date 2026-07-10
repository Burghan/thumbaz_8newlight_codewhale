-- 011: enhance users table with rate and contact info.
ALTER TABLE users ADD COLUMN rate INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN notes TEXT;

-- Also link attendances to users.
ALTER TABLE attendances ADD COLUMN user_id INTEGER REFERENCES users(id);
