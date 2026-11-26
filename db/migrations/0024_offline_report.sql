-- A report made on a phone with no signal and sent when signal came back (LR-03 to LR-05). Its id
-- is made on the phone, once, so a send repeated after a lost answer gives the same ticket.
CREATE TABLE offline_send (
  client_id text PRIMARY KEY,
  ticket_number text NOT NULL REFERENCES ticket (ticket_number),
  at text NOT NULL
);
