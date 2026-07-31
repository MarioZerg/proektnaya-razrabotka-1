CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    login VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    password_salt VARCHAR(64) NOT NULL,
    full_name VARCHAR(200) NOT NULL,
    role VARCHAR(30) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO users (login, password_hash, password_salt, full_name, role)
VALUES (
    'admin',
    'fd6719b2fe2fd097a7a1f5c743aaa3222a5b50a8df380236decc9b5b5ec032e4',
    '4e536f4e69b728fe82ca617d384b0506',
    'Администратор',
    'admin'
);