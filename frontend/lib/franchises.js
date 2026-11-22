// Default franchise catalogue for the SETUP screen. When a saved auction is
// present, the authoritative franchises from backend state replace these.
export const FRANCHISE_CATALOGUE = [
  {
    id: 'F1', name: 'Mumbai Indians', short: 'MI', city: 'Mumbai',
    primary: '#0456b5', secondary: '#27a5f5', owner: 'Reliance Industries',
    strategy: 'AGGRESSIVE', headCoach: 'Mahela Jayawardene', directorCricket: 'Jim Rohnt',
  },
  {
    id: 'F2', name: 'Chennai Super Kings', short: 'CSK', city: 'Chennai',
    primary: '#f5d142', secondary: '#1e5aa8', owner: 'Chennai Super Kings Ltd.',
    strategy: 'VALUE', headCoach: 'Stephen Fleming', directorCricket: 'CSK Management',
  },
  {
    id: 'F3', name: 'Royal Challengers Bengaluru', short: 'RCB', city: 'Bengaluru',
    primary: '#c8102e', secondary: '#151515', owner: 'Royal Challengers Sports',
    strategy: 'AGGRESSIVE', headCoach: 'Andy Flower', directorCricket: 'RCB Management',
  },
  {
    id: 'F4', name: 'Kolkata Knight Riders', short: 'KKR', city: 'Kolkata',
    primary: '#5c2a85', secondary: '#f5c518', owner: 'Knight Riders Sports',
    strategy: 'AGGRESSIVE', headCoach: 'Chandrakant Pandit', directorCricket: 'KKR Management',
  },
  {
    id: 'F5', name: 'Delhi Capitals', short: 'DC', city: 'Delhi',
    primary: '#1e4fa3', secondary: '#e8462b', owner: 'GMR Group & JSW Sports',
    strategy: 'BALANCED', headCoach: 'Ricky Ponting', directorCricket: 'DC Management',
  },
  {
    id: 'F6', name: 'Sunrisers Hyderabad', short: 'SRH', city: 'Hyderabad',
    primary: '#f47a20', secondary: '#1b1b1b', owner: 'Sun TV Network',
    strategy: 'AGGRESSIVE', headCoach: 'Daniel Vettori', directorCricket: 'SRH Management',
  },
  {
    id: 'F7', name: 'Rajasthan Royals', short: 'RR', city: 'Jaipur',
    primary: '#e2231a', secondary: '#2b2b2b', owner: 'Royals Sports Group',
    strategy: 'CONSERVATIVE', headCoach: 'Rahul Dravid', directorCricket: 'RR Management',
  },
  {
    id: 'F8', name: 'Punjab Kings', short: 'PBKS', city: 'Mohali',
    primary: '#d5232f', secondary: '#f2b90c', owner: 'Sharad Kelkar Sports',
    strategy: 'BALANCED', headCoach: 'Trevor Bayliss', directorCricket: 'PBKS Management',
  },
  {
    id: 'F9', name: 'Gujarat Titans', short: 'GT', city: 'Ahmedabad',
    primary: '#1b3c6b', secondary: '#65c8e6', owner: 'Torrent Group',
    strategy: 'BALANCED', headCoach: 'Ashish Nehra', directorCricket: 'GT Management',
  },
  {
    id: 'F10', name: 'Lucknow Super Giants', short: 'LSG', city: 'Lucknow',
    primary: '#7b3fa1', secondary: '#f2a900', owner: 'RP-Sanjiv Goenka Group',
    strategy: 'CONSERVATIVE', headCoach: 'Justin Langer', directorCricket: 'LSG Management',
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
