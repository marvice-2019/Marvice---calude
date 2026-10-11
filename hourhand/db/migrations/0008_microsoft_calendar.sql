-- B6: Teams links. Whether a calendar can create Teams meetings (Microsoft says so per calendar); null when unknown,
-- as for Google calendars and Microsoft calendars saved before this column existed.
alter table calendars add column can_teams boolean;
