INSERT INTO public.org_settings (
  company_name,
  company_state,
  company_state_code,
  registered_address,
  corporate_address,
  cin,
  supplier_type,
  default_hsn_sac,
  invoice_declaration,
  invoice_note
)
SELECT
  'PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD.',
  'Delhi',
  '07',
  'B-48, Third Floor, Naraina Industrial Area, Phase-II, New Delhi, South West Delhi, Delhi - 110028',
  'B-48, Third Floor, Naraina Industrial Area, Phase-II, New Delhi, Delhi - 110028',
  'U74140DL2010PTC198188',
  'Company',
  '998525',
  'No complaints in respect of services supplied vide this invoice will be entertained unless the same is lodged in writing within 07 days from delivery.',
  'Delay in payment beyond the agreed credit period will attract interest at 24% per annum.'
WHERE NOT EXISTS (SELECT 1 FROM public.org_settings);

UPDATE public.org_settings
SET
  company_name = COALESCE(NULLIF(company_name, ''), 'PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD.'),
  company_state = COALESCE(NULLIF(company_state, ''), 'Delhi'),
  company_state_code = COALESCE(NULLIF(company_state_code, ''), '07'),
  registered_address = COALESCE(NULLIF(registered_address, ''), 'B-48, Third Floor, Naraina Industrial Area, Phase-II, New Delhi, South West Delhi, Delhi - 110028'),
  corporate_address = COALESCE(NULLIF(corporate_address, ''), 'B-48, Third Floor, Naraina Industrial Area, Phase-II, New Delhi, Delhi - 110028'),
  cin = COALESCE(NULLIF(cin, ''), 'U74140DL2010PTC198188'),
  supplier_type = COALESCE(NULLIF(supplier_type, ''), 'Company'),
  default_hsn_sac = COALESCE(NULLIF(default_hsn_sac, ''), '998525'),
  invoice_declaration = COALESCE(NULLIF(invoice_declaration, ''), 'No complaints in respect of services supplied vide this invoice will be entertained unless the same is lodged in writing within 07 days from delivery.'),
  invoice_note = COALESCE(NULLIF(invoice_note, ''), 'Delay in payment beyond the agreed credit period will attract interest at 24% per annum.'),
  updated_at = now();