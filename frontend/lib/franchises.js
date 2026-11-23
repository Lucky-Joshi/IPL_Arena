// Default franchise catalogue for the SETUP screen. When a saved auction is
// present, the authoritative franchises from backend state replace these.
export const FRANCHISE_CATALOGUE = [
  {
    id: 'F1', name: 'Aurangabad Aces', short: 'AAA', city: 'Aurangabad',
    primary: '#E63946', secondary: '#1D3557', owner: 'Meera Kapoor',
    strategy: 'AGGRESSIVE', headCoach: 'Vikram Desai', directorCricket: 'Anand Rao',
  },
  {
    id: 'F2', name: 'Bengaluru Blaze', short: 'BLZ', city: 'Bengaluru',
    primary: '#FF6B35', secondary: '#004E89', owner: 'Rohan Bhatia',
    strategy: 'VALUE', headCoach: 'Nigel Dsouza', directorCricket: 'Sanjay Gowda',
  },
  {
    id: 'F3', name: 'Chennai Chargers', short: 'CHC', city: 'Chennai',
    primary: '#FFD166', secondary: '#073B4C', owner: 'Lakshmi Venkatesh',
    strategy: 'CONSERVATIVE', headCoach: 'Murali Krishnan', directorCricket: 'Deepa Natarajan',
  },
  {
    id: 'F4', name: 'Delhi Dynamos', short: 'DDY', city: 'Delhi',
    primary: '#3A86FF', secondary: '#14213D', owner: 'Aditi Malhotra',
    strategy: 'AGGRESSIVE', headCoach: 'Ajay Bhandari', directorCricket: 'Ravi Sehgal',
  },
  {
    id: 'F5', name: 'Hyderabad Hawks', short: 'HYH', city: 'Hyderabad',
    primary: '#8E44AD', secondary: '#2B2D42', owner: 'Farhan Qureshi',
    strategy: 'BALANCED', headCoach: 'Mohsin Ali', directorCricket: 'Sana Begum',
  },
  {
    id: 'F6', name: 'Kolkata Kings', short: 'KKG', city: 'Kolkata',
    primary: '#6A4C93', secondary: '#F4A261', owner: 'Ritwik Sengupta',
    strategy: 'VALUE', headCoach: 'Subrata Dutta', directorCricket: 'Indrani Bose',
  },
  {
    id: 'F7', name: 'Lucknow Lancers', short: 'LKL', city: 'Lucknow',
    primary: '#2A9D8F', secondary: '#264653', owner: 'Pragya Srivastava',
    strategy: 'BALANCED', headCoach: 'Brijesh Yadav', directorCricket: 'Nisha Awasthi',
  },
  {
    id: 'F8', name: 'Nagpur Ninjas', short: 'NGN', city: 'Nagpur',
    primary: '#EF476F', secondary: '#118AB2', owner: 'Vikrant Deshmukh',
    strategy: 'CONSERVATIVE', headCoach: 'Prasad Kulkarni', directorCricket: 'Amruta Bhandari',
  },
  {
    id: 'F9', name: 'Pune Panthers', short: 'PNP', city: 'Pune',
    primary: '#06D6A0', secondary: '#073B4C', owner: 'Shreyas Gadgil',
    strategy: 'AGGRESSIVE', headCoach: 'Mangesh Pawar', directorCricket: 'Sonal Joshi',
  },
  {
    id: 'F10', name: 'Vizag Vipers', short: 'VZV', city: 'Visakhapatnam',
    primary: '#E76F51', secondary: '#2A3B5C', owner: 'Padma Varma',
    strategy: 'VALUE', headCoach: 'Srinivasa Rao', directorCricket: 'Kiran Kumar',
  },
];

export function catalogueFromState(state) {
  if (!state?.franchises?.length) return FRANCHISE_CATALOGUE;
  return state.franchises.map((franchise, index) => {
    const fallback = FRANCHISE_CATALOGUE.find(
      (entry) => entry.id === franchise.id || entry.short === franchise.short
    ) || FRANCHISE_CATALOGUE[index % FRANCHISE_CATALOGUE.length];
    return { ...fallback, ...franchise };
  });
}
