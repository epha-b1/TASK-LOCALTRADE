INSERT INTO roles(code)
VALUES ('buyer'), ('seller'), ('moderator'), ('arbitrator'), ('admin')
ON CONFLICT (code) DO NOTHING;
