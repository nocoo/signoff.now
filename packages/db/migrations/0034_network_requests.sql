CREATE TABLE network_requests (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('adoDiscovery','adoDetails','adoChecks','jev')),
 at INTEGER NOT NULL
);
CREATE INDEX network_requests_at ON network_requests(at);
