Feature: Bankruptcy and game over
  Whoever cannot pay their debts is out. The last player wins.

  Scenario: Ben declares bankruptcy and Anna wins
    Given Anna and Ben play a game in Switzerland
    And Ben has cash of 20
    And Ben owes Anna 500
    When Ben declares bankruptcy
    Then Anna sees that Anna wins the game
    And Ben sees that Anna wins the game
