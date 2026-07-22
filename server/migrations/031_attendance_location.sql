-- Optional GPS coordinates captured alongside the clock-in/out photo, so a
-- clocked location can be checked against the shop's address later.
ALTER TABLE attendances ADD COLUMN lat_in REAL;
ALTER TABLE attendances ADD COLUMN lng_in REAL;
ALTER TABLE attendances ADD COLUMN lat_out REAL;
ALTER TABLE attendances ADD COLUMN lng_out REAL;
