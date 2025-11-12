/*
    Allocation distribution if the difference of % gain between two lending protocols
    if greater than 2,4,6 then we are distributing accordingly
    Feel free to change the values and add more distributions 
    WARNING : DO NOT EDIT THE TYPE FORMAT
    2% = 60%, 40% allocation
    4% = 70%, 30% allocation
    6% = 80%, 20% allocation
*/
type AllocationPair = [number,number];
export const allocationDistributionChart : Record<number, AllocationPair>= {
  200: [6000, 4000],
  400: [7000, 3000],
  600: [8000, 2000],
};
