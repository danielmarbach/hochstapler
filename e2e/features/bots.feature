Feature: Playing with bots
  Bots fill empty seats and play immediately when it is their turn.

  Scenario: The bot moves after Anna's turn and hands the game back
    Given Anna plays in Switzerland against a bot
    And the dice sequence is 2+4, 2+4
    When Anna rolls
    And Anna buys the property
    And Anna ends her turn
    Then it is Anna's turn again
    And Anna sees that Heidi vom Pilatus has a balance of 1'996
    And Anna has a balance of 1'904
