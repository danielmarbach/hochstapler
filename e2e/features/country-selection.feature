Feature: Country selection
  The chosen country determines tile names, currency and event texts.

  Scenario: A France game shows French tile names and euros
    Given Anna and Ben play a game in France
    And it is Anna's turn
    And the dice sequence is 2+4
    When Anna rolls
    Then Anna is offered the chance to buy "Petite France"
    When Anna buys the property
    Then Anna has a balance of 1'900
    And Anna owns "Petite France"
