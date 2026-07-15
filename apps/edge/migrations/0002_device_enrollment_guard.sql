ALTER TABLE enrollment_codes ADD COLUMN used_by_device_id TEXT;

CREATE TRIGGER devices_active_pilot_limit
BEFORE INSERT ON devices
WHEN NEW.active = 1 AND (SELECT COUNT(*) FROM devices WHERE site_id = NEW.site_id AND active = 1) >= 5
BEGIN
  SELECT RAISE(ABORT, 'device_limit_reached');
END;

CREATE TRIGGER devices_reactivation_pilot_limit
BEFORE UPDATE OF active ON devices
WHEN OLD.active = 0 AND NEW.active = 1 AND (SELECT COUNT(*) FROM devices WHERE site_id = NEW.site_id AND active = 1) >= 5
BEGIN
  SELECT RAISE(ABORT, 'device_limit_reached');
END;
