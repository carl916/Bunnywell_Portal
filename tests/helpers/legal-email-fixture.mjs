export const emailNow = Date.parse('2026-09-22T12:00:00Z');
export const emailExpiry = '2026-09-24T14:18:00Z';
export const emailSnapshot = {
  sale_id: '40000000-0000-4000-8000-000000000001', unit_id: '20000000-0000-4000-8000-000000000001',
  building: { id: '10000000-0000-4000-8000-000000000001', name: 'Riverside House', seller_name: 'Riverside Developments Ltd', completion_information: 'Completion following notice under the contract.' },
  plot: '105', buyer: 'Alex Morgan / Jamie Morgan',
  conveyancer: { id: 'legal-team', type: 'conveyancer', name: 'Riverside Legal', shared_system_email: 'legal@example.test' },
  sales_agent: { id: 'sales-team', type: 'sales_agent', name: 'Riverside Sales', shared_system_email: 'sales@example.test' },
  approver: { id: 'approver', name: 'Sam Taylor' },
  terms: { contract_price: 325000, reservation_fee: 2000, reservation_fee_holder: 'sales_agent', exchange_deposit_percent: 10,
    second_deposit_enabled: true, second_deposit_percent: 5, second_deposit_months_after_exchange: 3, completion_balance_percent: 85,
    deposit_summary: '10% on exchange, 5% 3 months after exchange, 85% on completion', developer_contribution: 5000, agent_contribution: 0, other_concessions: 0,
    parking_location_details: '', parking_value: 0, parking_contribution_value: 0, additional_special_conditions: ['Integrated kitchen appliances included.'], commercial_summary: '' },
  schedule: [
    { payment_stage: 'exchange', label: '10% exchange deposit', percent_of_contract_price: 10, expected_amount: 32500, due_event: 'exchange', due_offset_days: 0, includes_reservation_fee: true },
    { payment_stage: 'delayed_deposit', label: '5% second deposit', percent_of_contract_price: 5, expected_amount: 16250, due_event: 'manual_date', due_offset_days: 93 },
    { payment_stage: 'completion', label: '85% balance on completion', percent_of_contract_price: 85, expected_amount: 276250, due_event: 'completion', due_offset_days: 0 },
  ],
};
