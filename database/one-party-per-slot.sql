create unique index if not exists dynamo_party_slot_one_booking on public.dynamo_party_bookings(party_id) where status='Booked';
