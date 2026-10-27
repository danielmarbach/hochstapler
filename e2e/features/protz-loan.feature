Feature: Show-off mode (bank loans)
  In the optional show-off mode a player may borrow from the bank on their own turn to buy or
  build faster. The bank fixes the interest rate when the loan is taken: the richer the player
  compared with the table, the higher the rate. The interest is due at the start of each own turn.
  This applies on desktop and phone alike.

  Scenario: The host enables the show-off mode when creating the game
    When Anna creates a game in Switzerland with the show-off mode on the start page
    Then the lobby for Anna shows the show-off notice "Protzmodus (Bankkredite)"

  Scenario: Without the mode there is no loan
    Given Anna and Ben play a game in Switzerland
    And it is Anna's turn
    Then Anna has no loan button

  Scenario: Anna borrows, pays the interest at her next turn and repays
    Given Anna and Ben play a game in Switzerland with the show-off mode
    And it is Anna's turn
    When Anna opens the loan dialog
    Then the loan dialog for Anna says "Der Privatbankier am Paradeplatz leiht dir bis zu CHF 1'000"
    And the loan dialog for Anna shows the rate "Die Bank verlangt von dir 8 % pro Runde."
    When Anna borrows 300
    Then Anna has a balance of 2'300
    And the player card of Anna shows "Kredit CHF 300 · 8 %"
    Given it is Ben's turn and the dice have been rolled
    When Ben ends his turn
    Then Anna has a balance of 2'276
    When Anna repays 300
    Then Anna has a balance of 1'976
    And the player card of Anna shows no loan

  Scenario: The leader pays a higher rate than the trailing player
    Given Anna and Ben play a game in Switzerland with the show-off mode
    And Ben has cash of 6000
    And it is Anna's turn
    When Anna opens the loan dialog
    Then the loan dialog for Anna shows the rate "Die Bank verlangt von dir 4 % pro Runde."
    Given it is Ben's turn
    When Ben opens the loan dialog
    Then the loan dialog for Ben shows the rate "Die Bank verlangt von dir 25 % pro Runde."

  Scenario: No loan to pay a debt
    Given Anna and Ben play a game in Switzerland with the show-off mode
    And Anna has cash of 100
    And Anna owes Ben 500
    Then Anna cannot borrow
