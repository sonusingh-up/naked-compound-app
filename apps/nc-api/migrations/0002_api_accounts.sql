ALTER TABLE users ADD COLUMN resend_contact_id TEXT;

CREATE TABLE review_request_votes (
  request_id TEXT NOT NULL REFERENCES review_requests(id),
  voter_key TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (request_id, voter_key)
);
CREATE INDEX review_request_votes_user ON review_request_votes(user_id) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX review_requests_open_listing_unique
  ON review_requests(retailer, external_id)
  WHERE status = 'open' AND retailer IS NOT NULL AND external_id IS NOT NULL;
CREATE UNIQUE INDEX review_requests_open_gtin_unique
  ON review_requests(gtin)
  WHERE status = 'open' AND gtin IS NOT NULL;
