INSERT INTO public.deduction_types (name, code, sort_order, formula, rate_source)
VALUES
  ('EPF Employee', 'epf_employee', 10, '{}'::jsonb, 'fixed'),
  ('ESI Employee', 'esi_employee', 20, '{}'::jsonb, 'fixed'),
  ('Professional Tax', 'professional_tax', 30, '{}'::jsonb, 'fixed'),
  ('Labour Welfare Fund Employee', 'lwf_employee', 40, '{}'::jsonb, 'fixed'),
  ('Uniform', 'uniform', 50, '{}'::jsonb, 'fixed'),
  ('GPAIP', 'gpaip', 60, '{}'::jsonb, 'fixed'),
  ('Recruitment Fee', 'recruitment_fee', 70, '{}'::jsonb, 'fixed'),
  ('Salary Advance', 'salary_advance', 80, '{}'::jsonb, 'fixed'),
  ('General Deduction', 'general_deduction', 90, '{}'::jsonb, 'fixed'),
  ('Miscellaneous', 'miscellaneous', 100, '{}'::jsonb, 'fixed')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.addition_types (name, code, sort_order, formula, rate_source)
VALUES
  ('Bonus', 'bonus', 10, '{}'::jsonb, 'fixed'),
  ('Incentive', 'incentive', 20, '{}'::jsonb, 'fixed'),
  ('Arrears', 'arrears', 30, '{}'::jsonb, 'fixed'),
  ('Uniform Allowance', 'uniform_allowance', 40, '{}'::jsonb, 'fixed'),
  ('Extra Duty Allowance', 'overtime_allowance', 50, '{}'::jsonb, 'fixed'),
  ('Leave Encashment', 'leave_encashment', 60, '{}'::jsonb, 'fixed'),
  ('Miscellaneous', 'miscellaneous', 70, '{}'::jsonb, 'fixed')
ON CONFLICT (code) DO NOTHING;