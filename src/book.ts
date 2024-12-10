import FBSInteractor from './FBSInteractor';

// Single booking example
FBSInteractor.bookSlot(
    "2024-12-10 18:00:00",  // start time
    "2024-12-10 19:30:00",  // end time
    "Gym Session",          // purpose
    10,                     // locationID (10 for Gym)
    "Student Activities",   // usage type
    2                      // number of users
);