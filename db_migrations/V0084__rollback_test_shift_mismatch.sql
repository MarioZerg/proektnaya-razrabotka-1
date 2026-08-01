UPDATE orders SET sewing_status='На раскрое', assigned_user_id=NULL, workshop_id=NULL, material=NULL, width=NULL, height=NULL, cut_at=NULL WHERE id=13;
UPDATE rolls SET remaining_quantity = remaining_quantity + 2.050 WHERE id=5;
UPDATE rolls SET remaining_quantity = remaining_quantity + 1.000 WHERE id=3;
UPDATE rolls SET remaining_quantity = remaining_quantity + 1.000 WHERE id=4;
UPDATE rolls SET shift_number=1 WHERE id=1;
UPDATE users SET shift_number=NULL WHERE id=9;